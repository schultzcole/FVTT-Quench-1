import QuenchResults from "./apps/quench-results.js";
import QuenchReporter from "./quench-reporter.js";
import { quenchUtils } from "./utils/quench-utils.js";
import { quenchSnapUtils } from "./snapshot.js";

/**
 * The `Quench` class is the "hub" of the Quench module. It contains the primary public API for Quench, as well as references to the global
 * mocha and chai objects.
 *
 * @property {Mocha} mocha - the global mocha instance
 * @property {object} chai - the global chai instance
 * @property {object} utils - Various utility functions
 * @property {object} snapUtils - Utility functions related to snapshot handling
 * @property {Map<string, object>} _testBatches - a map of registered test batches
 * @property {Object.<string, object>} _snapshotCache - the object storing snapshots
 * @property {QuenchResults} app - the singleton instance of `QuenchResults` that this `Quench` instance uses
 */
export default class Quench {
  constructor(mocha, chai) {
    this.mocha = mocha;
    this.mocha._cleanReferencesAfterRun = false;
    this.chai = chai;
    this.utils = quenchUtils;
    this.snapUtils = quenchSnapUtils;
    this._testBatches = new Map();
    this._snapshotCache = quenchSnapUtils.fileCache;
    this.app = new QuenchResults(this);
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
   * @param {string} key - The test batch's unique string key. Only one test batch with a given key can exist at one time.
   *     If you register a test batch with a pre-existing key, it will overwrite the previous test batch.
   * @param {function} fn - The function which will be called to register the suites and tests within your test batch.
   * @param {object} options
   * @param {string|null} [options.displayName] - A user-friendly name to show in the Quench UI and detailed results.
   * @param {string|null} [options.snapshotDir] - The directory in which snapshots for this batch are stored.
   */
  registerBatch(key, fn, { displayName = null, snapshotDir = null } = {}) {
    const [packageName] = this.utils._internal.getBatchNameParts(key);
    if (![...game.modules, game.system].map((p) => p[0]).includes(packageName)) {
      ui?.notifications?.error(
        game?.i18n?.format("QUENCH.ERROR.InvalidPackageName", { key, packageName }),
      );
    }
    if (this._testBatches.has(key)) {
      ui?.notifications?.warn(game.i18n.format("QUENCH.WARN.BatchAlreadyExists", { key }));
    }
    this._testBatches.set(key, {
      displayName: displayName ?? key,
      fn,
      snapshotDir: snapshotDir ?? this.snapUtils.getDefaultSnapDir(key),
    });
    this.app.clear();
  }

  /**
   * Runs all test batches.
   *
   * The contents of the test batches are registered with mocha when this function is executed.
   *
   * @returns {Promise<Runner>} - Returns the mocha Runner object for this test run.
   */
  async runAllBatches() {
    return this.runSelectedBatches(this._testBatches.keys());
  }

  /**
   * Runs the test batches defined by the keys in `batchKeys`.
   *
   * The contents of the test batches are registered with mocha when this function is executed.
   *
   * @param {string[]} batchKeys - Array of keys for the test batches to be run.
   * @returns {Promise<Runner>} - Returns the mocha Runner object for this test run.
   */
  async runSelectedBatches(batchKeys, { updateSnapshots = null } = {}) {
    // Cleanup - create a new root suite and clear the state of the results application
    mocha.suite = new Mocha.Suite("__root", new Mocha.Context(), true);
    await this.app.clear();

    // Initialize mocha with a quench reporter
    mocha.setup({
      ui: "bdd",
      reporter: QuenchReporter,
    });

    // Prepare context methods to be provided to test fixtures
    const { after, afterEach, before, beforeEach, describe, it, utils } = Mocha;
    const { assert, expect } = this.chai;
    // Run should to patch object prototype
    const should = this.chai.should();

    const context = {
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
    await this.snapUtils.loadAllSnaps(batchKeys);
    // Explicit flag > flag set before this run > default flag
    this._updateSnapshots = updateSnapshots ?? this._updateSnapshots ?? false;

    // Register suites and tests for provided batches
    for (const key of batchKeys) {
      // Override `describe` to add a property to the resulting suite indicating which quench batch the suite belongs to.
      context.describe = function quenchDescribe(...args) {
        const suite = describe(...args);
        suite._quench_parentBatch = key;
        return suite;
      };

      // Override `it` to add a property to the resulting test indicating which quench batch the test belongs to.
      context.it = function quenchIt(...args) {
        const test = it(...args);
        test._quench_parentBatch = key;
        return test;
      };

      // Create a wrapper suite to contain this test batch
      const testBatchRoot = context.describe(`${key}_root`, async () => {
        // Call the batch's registration function
        await this._testBatches.get(key).fn(context);
      });
      testBatchRoot._quench_batchRoot = true;
    }

    // Run the tests and hold on to the runner
    this._currentRunner = this.mocha.run();
    const EVENT_RUN_END = this._currentRunner.constructor.constants.EVENT_RUN_END;
    this._currentRunner.once(EVENT_RUN_END, () => {
      this._currentRunner = null;
      this._updateSnapshots = null;
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
