# Quench

![Latest Release Download Count](https://img.shields.io/github/downloads/Ethaks/FVTT-Quench/latest/module.zip)
[![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fquencg&colorB=4aa94a)](https://forge-vtt.com/bazaar#package=quench)
[![Foundry Hub Endorsements](https://img.shields.io/endpoint?logoColor=white&url=https%3A%2F%2Fwww.foundryvtt-hub.com%2Fwp-json%2Fhubapi%2Fv1%2Fpackage%2Fquench%2Fshield%2Fendorsements)](https://www.foundryvtt-hub.com/package/quench/)
![Supported Foundry Versions](https://img.shields.io/endpoint?url=https://foundryshields.com/version?url=https://github.com/Ethaks/FVTT-Quench/releases/latest/download/module.json)

Harden your Foundry module or system code with end-to-end UI tests directly within Foundry.
Powered by [Mocha](https://mochajs.org/) and also includes [Chai](https://www.chaijs.com/).

Quench adds a test runner UI as a native Foundry `Application`.
You can register test suites with quench and view them in the test runner, then run them and view the results.

![Example Tests](docs/example-tests.webp)

## Usage

The primary public API is the `Quench` class.
A global instance of `Quench` is available as a global called `quench`.
This class includes references to both the mocha and chai globals, as well as some methods to add new test batches and run the tests.

Quench uses "test batches" as another layer of organization above the built-in mocha suites and tests.
Test batches are at the top layer of the hierarchy, can contain suites and/or tests, and can be enabled or disabled through the Quench UI.
Enabling or disabling batches allows you to pick and choose only a subset of suites and tests to execute in one test run.

### `quenchReady` Hook

Quench provides a `"quenchReady"` hook, which indicates when Quench is ready for you to start registering batches.
`"quenchReady"` is guaranteed to occur after the core `"init"` hook, but its ordering relative to the core `"setup"` and `"ready"` hooks is not guaranteed.
`"quenchReady"` receives the current `Quench` instance as an argument.

### Register a test batch

You can register a Quench test batch to be executed with Quench by calling `quench.registerBatch`.
`registerBatch` takes the following arguments:

- `key` - a unique batch key that identifies this test batch.
  If multiple test batches are registered with the same key, the latest registration will overwrite previous registrations.
- `registrationFunction` - this function will be executed to register the suites and tests within this batch.
  It takes a `context` argument, which contains the following Mocha and Chai functions necessary for defining a suite of tests:
  - Mocha - `describe`, `it`, `after`, `afterEach`, `before`, `beforeEach`, and `utils`.
  - Chai - `assert`, `expect`, and `should`. `should` is also made available by extending `Object.prototype`.
- `options` -
  - `displayName` - the name for this batch that will be shown in the ui and in the detailed test results.
    This is optional, quench will fall back to the batch key if omitted.

Example:
```js
Hooks.on("quenchReady", quench => {
    quench.registerBatch("quench.examples.basic-pass", (context) => {
        const { describe, it, assert } = context;

        describe("Passing Suite", function () {
            it("Passing Test", function () {
                assert.ok(true);
            });
        });
    }, { displayName: "QUENCH: Basic Passing Test" });
});
```

### Conventions

By convention, batch keys should begin with the package short name, followed by a period and then a simple identifier for the batch.
Batch display names should begin with the package name in caps, followed by a colon, and a short description of the tests included in the batch.

Key: `<package>.batch.identifier`  
Display name: `<PACKAGE>: A description of the batch's contents`

## License

Licensed under the GPLv3 License (see [LICENSE](LICENSE)).
