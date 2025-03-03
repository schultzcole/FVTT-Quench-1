import type { Quench } from "../quench";

/**
 * Pauses execution for the given number of milliseconds
 * @param millis - duration to pause for in milliseconds
 */
async function pause(millis: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

/**
 * Resets the world to a blank state with no entities.
 *
 * WARNING: This will permanently delete every entity in your world (scenes, actors, items, macros, roll tables, journal entries, playlists, chat messages, folders, etc.)
 */
async function clearWorld(): Promise<void> {
  const exclude = new Set([User].map((element) => element.metadata.name));
  for (const collection of Object.values(game)) {
    if (!(collection instanceof DocumentCollection) || exclude.has(collection.documentName))
      continue;
    if (collection.size === 0) continue;

    await collection.documentClass.deleteDocuments(collection.map((document_) => document_.id));
  }
}

/**
 * Represents the state of a test or suite
 */
const RUNNABLE_STATES = {
  IN_PROGRESS: "progress",
  PENDING: "pending",
  SUCCESS: "success",
  FAILURE: "failure",
} as const;
export type RUNNABLE_STATE = typeof RUNNABLE_STATES[keyof typeof RUNNABLE_STATES];

/**
 * Gets the STATE of a Test instance
 * @param test - the mocha Test instance to determine the state of
 * @returns the state of the test
 */
function getTestState(test: Mocha.Test): RUNNABLE_STATE {
  if (test.pending) {
    return RUNNABLE_STATES.PENDING;
  } else if (test.state === undefined) {
    return RUNNABLE_STATES.IN_PROGRESS;
  } else if (test.state === "passed") {
    return RUNNABLE_STATES.SUCCESS;
  } else {
    return RUNNABLE_STATES.FAILURE;
  }
}

/**
 * Gets the STATE of a Suite instance, based on the STATE of its contained suites and tests
 * @param suite - the mocha Suite instance to determine the state of
 * @returns the state of the suite
 */
function getSuiteState(suite: Mocha.Suite): RUNNABLE_STATE {
  if (suite.pending) return RUNNABLE_STATES.PENDING;

  // Check child tests
  const testStates = suite.tests.map((element) => getTestState(element));
  const allTestSucceed = testStates.every((t) => t !== RUNNABLE_STATES.FAILURE);
  if (!allTestSucceed) return RUNNABLE_STATES.FAILURE;

  // Check child suites
  const suiteStates = suite.suites.map((element) => getSuiteState(element));
  const allSuitesSucceed = suiteStates.every((t) => t !== RUNNABLE_STATES.FAILURE);
  return allSuitesSucceed ? RUNNABLE_STATES.SUCCESS : RUNNABLE_STATES.FAILURE;
}

/**
 * Returns a tuple containing the package name and the batch identifier
 *
 * @param batchKey - The batch key
 * @returns A tuple of package name and batch identifier
 */
function getBatchNameParts(batchKey: string): [string, string] {
  const index = batchKey.indexOf(".");
  return [batchKey.slice(0, index), batchKey.slice(index + 1)];
}

const logPrefix = "QUENCH | " as const;

/** Ensures {@link game} is initialized, either returning the {@link Game} instance or throwing an error. */
function getGame(): Game {
  if (!(game instanceof Game)) throw new Error("Game is not initialized yet!");
  return game;
}

function getQuench(): Quench {
  if (!quench) throw new Error("Quench is not initialized yet!");
  return quench;
}

/**
 * Localizes a string including variable formatting, using {@link Localization.format}.
 *
 * @param key - The ID of the string to be translated
 * @param [data] - Additional data
 * @returns The localized string
 */
function localize(key: string, data?: Record<string, unknown>): string {
  return getGame().i18n.format(`QUENCH.${key}`, data);
}

/**
 * Returns a string after truncating it to a fixed length.
 *
 * @param string - The string to be truncated
 * @param length - New maximum length
 * @returns The truncated string
 */
function truncate(string: string, length = 18): string {
  const dots = string.length > length ? "..." : "";
  return `${string.slice(0, Math.max(0, length)).replaceAll(/\r?\n|\r/g, " ")}${dots}`;
}

const internalUtils = {
  RUNNABLE_STATES,
  getBatchNameParts,
  getGame,
  getQuench,
  getSuiteState,
  getTestState,
  localize,
  logPrefix,
  truncate,
};

export const quenchUtils = {
  pause,
  clearWorld,
  _internal: internalUtils,
};
