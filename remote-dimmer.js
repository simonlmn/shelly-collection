/**
 * Remote Dimmer Controller Script
 * 
 * This script allows you to control Shelly dimmer devices remotely using input events. 
 * It currently supports the Shelly Dimmer 1/2 devices and implements a two-button dimmer control scheme. 
 * It supports switching the light on and off and dimming the light up/down by holding the corresponding input button.
 * 
 * Setup Instructions:
 * 1. Configure the remote dimmer settings in the KVS (Key-Value Store) with the key "remote-dimmer-config".
 *    Example configuration:
 *    [
 *      {
 *        "id": "front",
 *        "btn": {
 *          "0": "down",
 *          "1": "up"
 *        },
 *        "dev": {
 *          "addr": "192.168.3.127",
 *          "auth": "@credentials1"
 *        }
 *      },
 *      {
 *        "id": "back",
 *        "btn": {
 *          "2": "down",
 *          "3": "up"
 *        },
 *        "dev": {
 *          "addr": "192.168.3.127",
 *          "auth": "@credentials2"
 *        }
 *      }
 *    ]
 * 
 * 2. Store the device credentials in the KVS with the respective keys.
 *    Example credentials:
 *    { "id": "some-user", "pw": "some-password" }
 * 
 * Usage:
 * - The script listens for input events and triggers the corresponding actions on the configured dimmer devices.
 * - Long press on any input button will start dimming the light in the configured direction. It will also switch on the light if it is currently off.
 * - Short press on any input button will toggle the light on or off.
 */

// Possible actions for switching the light
const LIGHT_ACTIONS = {
    ON: "on",
    OFF: "off",
    TOGGLE: "toggle"
}

// Possible actions for dimming the light
const DIMMER_ACTIONS = {
    STOP: "stop",
    UP: "up",
    DOWN: "down"
};

const LONG_PUSH_TIME = 500;

const INPUT_COMPONENT_PREFIX = "input:";

const REMOTE_DIMMER_CONFIG_KEY = "remote-dimmer-config";

/* Example configuration to put in the KVS:
[
  {
    "id": "front",
    "btn": {
      "0": "down",
      "1": "up"
    },
    "dev": {
      "addr": "192.168.3.127",
      "auth": "@credentials1"
    }
  },
  {
    "id": "back",
    "btn": {
      "2": "down",
      "3": "up"
    },
    "dev": {
      "addr": "192.168.3.127",
      "auth": "@credentials2"
    }
  }
]
*/

/* Example credentials to put in the KVS:
{ "id": "some-user", "pw": "some-password" }
*/

function startsWith(str, prefix) {
    return str.substring(0, prefix.length) === prefix;
}

function callOk(error_code) {
    return error_code === 0;
}

function httpOk(error_code, response) {
    return callOk(error_code) && (response.code >= 200 && response.code < 300);
}

function getKVS(key, callback) {
    Shelly.call("KVS.Get", { key: key }, callback, null);
}

function getConfiguration(callback) {
    getKVS(REMOTE_DIMMER_CONFIG_KEY, function (response, error_code, error_message, ud) {
        if (!callOk(error_code)) {
            print("Failed to get configuration from KVS", error_message);
            return;
        }

        let configurations = JSON.parse(response.value);
        let toProcess = configurations.length;

        function proceedIfAllProcessed() {
            if (toProcess === 0) {
                toProcess = -1;
                callback(configurations);
            }
        }

        for (let i = 0; i < configurations.length; i++) {
            let config = configurations[i];
            if (config.dev.auth && startsWith(config.dev.auth, "@")) {
                let authKey = config.dev.auth.substring(1);
                print("Getting device credentials from KVS", config.id, authKey);
                getKVS(authKey, (function (response, error_code, error_message, ud) {
                    if (callOk(error_code)) {
                        print("Got device credentials from KVS");
                        this.dev.auth = JSON.parse(response.value);
                    } else {
                        print("Failed to get device credentials from KVS", error_message);
                        this.dev.auth = null;
                    }
                    toProcess--;
                    proceedIfAllProcessed();
                }).bind(config));
            } else {
                toProcess--;
            }
        }

        proceedIfAllProcessed();
    });
}

/**
 * Send an HTTP GET request to the dimmer device.
 * @param {string} endpointPath - The endpoint to send the request to.
 * @param {object} deviceConfig - The configuration object for the device. It should contain the address and optional authentication credentials.
 * @param {function} callback - The callback function to execute when the request completes.
 */
function sendRequest(endpointPath, deviceConfig, callback) {
    Shelly.call("http.get", { url: "http://" + (deviceConfig.auth ? (deviceConfig.auth.id + ":" + deviceConfig.auth.pw + "@") : "") + deviceConfig.addr + "/" + endpointPath }, callback, null);
}

/**
 * Get the current light status from the dimmer device.
 * @param {function} callback - The callback function to execute when the request completes.
 * 
 * See https://shelly-api-docs.shelly.cloud/devices/shelly-dimmer-2.html#light-0 for more information. The response body will look like:
 * {
 * "ison": false,
 * "source": "http",
 * "has_timer": false,
 * "timer_started": 0,
 * "timer_duration": 0,
 * "timer_remaining": 0,
 * "mode": "white",
 * "brightness": 25,
 * "transition": 0
 * }
 */
function getLightStatus(deviceConfig, callback) {
    sendRequest("light/0", deviceConfig, function (response, error_code, error_message, ud) {
        if (!httpOk(error_code, response)) {
            print("Failed to get light status", error_message, response.message);
            return;
        }

        let body = JSON.parse(response.body);
        print("getLightStatus", body.ison, body.brightness);
        callback(body);
    });
}

/**
 * Switch the light on, off, or toggle its state.
 * @param {string} action - The action to perform ("on", "off", or "toggle").
 * @param {function} callback - The callback function to execute when the request completes.
 */
function switchLight(deviceConfig, action, callback) {
    sendRequest("light/0?turn=" + action, deviceConfig, function (response, error_code, error_message, ud) {
        if (!httpOk(error_code, response)) {
            print("Failed to switch light", error_message, response.message);
            return;
        }

        let body = JSON.parse(response.body);
        print("switchLight", action, body.ison, body.brightness);
        callback(body);
    });
}

/**
 * Set the brightness of the light.
 * @param {number} brightness - The brightness level to set (0-100).
 * @param {function} callback - The callback function to execute when the request completes.
 */
function setLightBrightness(deviceConfig, brightness, callback) {
    sendRequest("light/0?brightness=" + brightness, deviceConfig, function (response, error_code, error_message, ud) {
        if (!httpOk(error_code, response)) {
            print("Failed to set light brightness", error_message, response.message);
            return;
        }

        let body = JSON.parse(response.body);
        print("setLightBrightness", body.brightness);
        callback(body);
    });
}

/**
 * Dim the light in the specified direction.
 * @param {string} action - The direction to dim ("up", "down", or "stop").
 * @param {function} callback - The callback function to execute when the request completes.
 */
function dimLight(deviceConfig, action, callback) {
    sendRequest("light/0?dim=" + action + (action !== DIMMER_ACTIONS.STOP ? "&step=100" : ""), deviceConfig, function (response, error_code, error_message, ud) {
        if (!httpOk(error_code, response)) {
            print("Failed to dim light", error_message, response.message);
            return;
        }

        print("dimLight", action);
        callback();
    });
}

function DimmerController(id, inputMapping, deviceConfig) {
    // Constants for state machine states
    const STATES = {
        IDLE: "IDLE",
        GET_LIGHT_STATUS: "GET_LIGHT_STATUS",
        WAITING_FOR_LONG_PUSH: "WAITING_FOR_LONG_PUSH",
        ENSURE_LIGHT_IS_ON: "ENSURE_LIGHT_IS_ON",
        DIMMING: "DIMMING"
    };

    // Valid state transitions
    const TRANSITIONS = {
        IDLE: [STATES.GET_LIGHT_STATUS, STATES.IDLE],
        GET_LIGHT_STATUS: [STATES.WAITING_FOR_LONG_PUSH, STATES.IDLE],
        WAITING_FOR_LONG_PUSH: [STATES.ENSURE_LIGHT_IS_ON, STATES.IDLE],
        ENSURE_LIGHT_IS_ON: [STATES.DIMMING, STATES.IDLE],
        DIMMING: [STATES.DIMMING, STATES.IDLE]
    };

    this._id = id;
    this._inputMapping = inputMapping;
    this._deviceConfig = deviceConfig;

    this._state = null;
    this._inputTriggerTime = 0;
    this._dimmerAction = DIMMER_ACTIONS.STOP;
    this._lightStatus = null;

    this.transitionTo = function (state) {
        if (this._state && TRANSITIONS[this._state].indexOf(state) === -1) {
            return;
        }

        print("[" + this._id + "]: transitioning from " + this._state + " to " + state);

        this._state = state;
        switch (state) {
            case STATES.GET_LIGHT_STATUS:
                this.enterGetLightStatus();
                break;
            case STATES.WAITING_FOR_LONG_PUSH:
                this.enterWaitingForLongPush();
                break;
            case STATES.ENSURE_LIGHT_IS_ON:
                this.enterEnsureLightIsOn();
                break;
            case STATES.DIMMING:
                this.enterDimming();
                break;
            case STATES.IDLE:
                this.enterIdle();
                break;
            default:
                print("[" + this._id + "]: unknown state", state);
                break;
        }
    };

    this.enterIdle = function () {
        this._inputTriggerTime = 0;
        this._dimmerAction = DIMMER_ACTIONS.STOP;
    };

    this.enterGetLightStatus = function () {
        getLightStatus(this._deviceConfig, (function (lightStatus) {
            this._lightStatus = lightStatus;
            this.transitionTo(STATES.WAITING_FOR_LONG_PUSH);
        }).bind(this));
    }

    this.enterWaitingForLongPush = function () {
        Timer.set(Math.max(1, LONG_PUSH_TIME - Math.round(Date.now() - this._inputTriggerTime)), false, (function () {
            this.transitionTo(STATES.ENSURE_LIGHT_IS_ON);
        }).bind(this), null);
    }

    this.enterEnsureLightIsOn = function () {
        if (!this._lightStatus.ison) {
            switchLight(this._deviceConfig, LIGHT_ACTIONS.ON, (function (lightStatus) {
                this._lightStatus = lightStatus;
                this.transitionTo(STATES.DIMMING);
            }).bind(this));
        } else {
            this.transitionTo(STATES.DIMMING);
        }
    }

    this.enterDimming = function () {
        dimLight(this._deviceConfig, this._dimmerAction, function () { });
    }

    this.handleInputEvent = function (e) {
        if (!startsWith(e.component, INPUT_COMPONENT_PREFIX)) { return; }

        let inputIndex = e.component.substring(INPUT_COMPONENT_PREFIX.length);
        if (this._inputMapping.hasOwnProperty(inputIndex)) {
            print("[" + this._id + "]: ---> input event", e.component, e.delta.state);
            if (e.delta.state === true) {
                if (this._state !== STATES.IDLE) {
                    this.transitionTo(STATES.IDLE);
                }
                this._inputTriggerTime = Date.now();
                this._dimmerAction = this._inputMapping[inputIndex];
                this.transitionTo(STATES.GET_LIGHT_STATUS);
            }
            else if (e.delta.state === false) {
                if (this._state === STATES.WAITING_FOR_LONG_PUSH || this._state === STATES.GET_LIGHT_STATUS) {
                    switchLight(this._deviceConfig, LIGHT_ACTIONS.TOGGLE, (function (lightStatus) {
                        this._lightStatus = lightStatus;
                        this.transitionTo(STATES.IDLE);
                    }).bind(this));
                } else if (this._state === STATES.DIMMING) {
                    dimLight(this._deviceConfig, DIMMER_ACTIONS.STOP, (function () {
                        this.transitionTo(STATES.IDLE);
                    }).bind(this));
                } else {
                    this.transitionTo(STATES.IDLE);
                }
            }
        }
    }
}

function main() {
    getConfiguration(function (config) {
        for (let i = 0; i < config.length; i++) {
            let controller = new DimmerController(config[i].id || ("dimmer-" + i), config[i].btn, config[i].dev);
            Shelly.addStatusHandler(controller.handleInputEvent.bind(controller));
            print("Set up dimmer controller", controller.id);
        }
        print("Remote dimmer controllers initialized");
    });
}

main();