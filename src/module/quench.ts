import * as chai from "chai";

import QuenchResults from "./apps/quench-results";
import QuenchReporter from "./quench-reporter";
import { QuenchSnapshotManager } from "./quench-snapshot";
import { quenchUtils } from "./utils/quench-utils";

const { getBatchNameParts, getGame, localize } = quenchUtils._internal;

/**
 * The `Quench` class is the "hub" of the Quench module. It contains the primary public API for Quench, as well as references to the global
 * mocha and chai objects.
 */
export default class Quench {
  /** Mocha's browser global */
  mocha: BrowserMocha = mocha;
  /** Chai's static object */
  chai: Chai.ChaiStatic = chai;

  /** Various utility functions */
  utils = quenchUtils;

  /**
   * A map of registered test batches
   * @internal
   */
  readonly _testBatches: Map<string, BatchData> = new Map();

  /** The singleton instance of {@link QuenchResults} that this `Quench` instance uses */
  readonly app = new QuenchResults(this);

  /** The {@link QuenchSnapshotManager} instance that this `Quench` instance uses */
  readonly snapshots = new QuenchSnapshotManager(this);

  /**
   * The current Mocha runner, if any
   * @internal
   */
  _currentRunner: Mocha.Runner | null = null;

  constructor() {
    this.mocha._cleanReferencesAfterRun = false;
  }

  /**
   * Registers a new Quench test batch which will show up in the quench window to be enabled/disabled and run.
   *
   * Suites and tests within a Quench test batch are not actually registered in the mocha runner until the user initiates the test run
   * with {@link Quench#runSelectedBatches}. When `runSelectedBatches` is executed, the provided batches' registration functions
   * are run and then the tests are executed.
   *
   * The registration function is passed a `context` argument, which contains the mocha and chai methods necessary for defining a test.
   * - Mocha - `describe`, `it`, `after`, `afterEach`, `before`, `beforeEach`, and `utils`.
   * - Chai - `assert`, `expect`, and `should`; the last one is also made available by extending `Object.prototype`.
   *
   * @example
   * quench.registerBatch("quench.examples.basic-pass", (context) => {
   *     const { describe, it, assert } = context;
   *
   *     describe("Passing Suite", function() {
   *         it("Passing Test", function() {
   *             assert.ok(true);
   *         });
   *     });
   * }, { displayName: "QUENCH: Basic Passing Test" });
   *
   * @param key - The test batch's unique string key. Only one test batch with a given key can exist at one time.
   *     If you register a test batch with a pre-existing key, it will overwrite the previous test batch.
   * @param fn - The function which will be called to register the suites and tests within your test batch.
   * @param [context] - Additional options affecting Quench's handling of this batch.
   */
  registerBatch(
    key: string,
    fn: QuenchRegisterSuiteFunction,
    context: QuenchBatchRegistrationOptions = {},
  ) {
    const { displayName, snapBaseDir, preSelected } = context;
    const [packageName] = getBatchNameParts(key);
    if (
      ![...getGame().modules, [getGame().system.id]].map(([pName]) => pName).includes(packageName)
    ) {
      ui?.notifications?.error(localize("ERROR.InvalidPackageName", { key, packageName }));
    }
    if (this._testBatches.has(key)) {
      ui?.notifications?.warn(localize("QUENCH.WARN.BatchAlreadyExists", { key }));
    }
    this._testBatches.set(key, {
      displayName: displayName ?? key,
      fn,
      snapBaseDir: snapBaseDir ?? QuenchSnapshotManager.getDefaultSnapDir(key),
      preSelected: preSelected ?? true,
    });
    this.app.clear();
  }

  /**
   * Returns a single batch's data.
   *
   * @param key - The batch key
   * @returns Batch data
   */
  getBatch(key: string): BatchData | undefined {
    return this._testBatches.get(key);
  }

  /**
   * Runs all test batches.
   *
   * The contents of the test batches are registered with mocha when this function is executed.
   *
   * @returns Returns the mocha Runner object for this test run.
   */
  async runAllBatches(): Promise<Mocha.Runner> {
    return this.runSelectedBatches([...this._testBatches.keys()]);
  }

  /**
   * Runs the test batches defined by the keys in `batchKeys`.
   *
   * The contents of the test batches are registered with mocha when this function is executed.
   *
   * @param batchKeys - Array of keys for the test batches to be run.
   * @param options - Additional options affecting the selected test runs
   * @param [options.updateSnapshots] - Whether snapshots generated in this run should be saved
   * @returns Returns the mocha Runner object for this test run.
   */
  async runSelectedBatches(
    batchKeys: string[],
    { updateSnapshots = null }: { updateSnapshots?: boolean | null } = {},
  ) {
    // Cleanup - create a new root suite and clear the state of the results application
    // @ts-expect-error Types are missing `isRoot` argument TODO: PR for DefinitelyTyped?
    mocha.suite = new Mocha.Suite("__root", new Mocha.Context(), true);
    await this.app.clear();

    // Initialize mocha with a quench reporter
    this.mocha.setup({
      ui: "bdd",
      reporter: QuenchReporter,
    });

    // Prepare context methods to be provided to test fixtures
    const { after, afterEach, before, beforeEach, describe, it, utils } = Mocha;
    const { assert, expect } = this.chai;
    // Run should to patch object prototype
    const should = this.chai.should();

    const baseContext: Omit<QuenchTestContext, "describe" | "it"> = {
      after,
      afterEach,
      before,
      beforeEach,
      utils,
      assert,
      expect,
      should,
    };

    // Fetch all snapshot files for the batches to be run
    await this.snapshots.loadBatchSnaps(batchKeys);
    // Explicit flag > flag set before this run > default flag
    updateSnapshots = updateSnapshots ?? this.snapshots.enableUpdates ?? false;

    const quenchify = <Fn extends Mocha.TestFunction | Mocha.SuiteFunction>(
      fn: Fn,
      key: string,
    ): Fn => {
      const quenchFn = function quenchFn(...args: Parameters<Fn>) {
        // @ts-expect-error Args are passed through as-is
        const result = fn(...args);
        result._quench_parentBatch = key;
        return result;
      };
      quenchFn.only = fn.only;
      quenchFn.skip = fn.skip;
      if ("retries" in fn) quenchFn.retries = fn.retries;
      return quenchFn as Fn;
    };

    // Register suites and tests for provided batches
    for (const key of batchKeys) {
      const context: QuenchTestContext = {
        ...baseContext,
        describe: quenchify(describe, key),
        it: quenchify(it, key),
      };

      // Create a wrapper suite to contain this test batch
      const testBatchRoot = context.describe(`${key}_root`, async () => {
        // Call the batch's registration function
        await this._testBatches.get(key)?.fn(context);
      });
      testBatchRoot._quench_batchRoot = true;
    }

    // Run the tests and hold on to the runner
    this._currentRunner = this.mocha.run();
    const EVENT_RUN_END = Mocha.Runner.constants.EVENT_RUN_END;
    this._currentRunner.once(EVENT_RUN_END, () => {
      this._currentRunner = null;
      if (updateSnapshots) this.snapshots.updateSnapshots();
      this.snapshots.enableUpdates = null;
    });
    return this._currentRunner;
  }

  /**
   * Aborts the currently running tests, if tests are currently running. Does nothing if no tests are currently running.
   * This will not cancel an in progress test. The run will abort after the currently running test completes.
   */
  abort() {
    this._currentRunner?.abort();
  }
}

interface QuenchBatchRegistrationOptions {
  /** A user-friendly name to show in the Quench UI and detailed results. */
  displayName?: string;
  /** The directory in which snapshots for this batch are stored. */
  snapBaseDir?: string;
  /**
   * Whether this batch should be checked when added to the UI
   * @defaultValue true
   */
  preSelected?: boolean;
}

/**
 * A function containing this batch's suites and tests.
 * Before each Quench run including this batch, this function will be called by Quench.
 *
 * @param context - Various Mocha and Chai functions
 */
type QuenchRegisterSuiteFunction = (context: QuenchTestContext) => void | Promise<void>;

/** Mocha and Chai functions passed by Quench */
interface QuenchTestContext {
  after: Mocha.HookFunction;
  afterEach: Mocha.HookFunction;
  before: Mocha.HookFunction;
  beforeEach: Mocha.HookFunction;
  utils: typeof Mocha.utils;
  assert: Chai.AssertStatic;
  expect: Chai.ExpectStatic;
  should: Chai.Should;

  describe: Mocha.SuiteFunction;
  it: Mocha.TestFunction;
}

interface BatchData {
  fn: QuenchRegisterSuiteFunction;
  displayName: string;
  snapBaseDir: string;
  preSelected: boolean;
}
