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

// Configuration settings for the dimmer device
const CONFIG = {
    dimmerDevice: {
        address: "192.168.3.127", // IP address of the dimmer device
        auth: null, // can be "username:password" or null for no authentication
    },
    inputMapping: { "input:0": DIMMER_ACTIONS.DOWN, "input:1": DIMMER_ACTIONS.UP },
    longPushTime: 500
};

// Data object to hold the current state and other relevant information
let DATA = {
    state: null,
    inputTriggerTime: 0,
    inputAction: DIMMER_ACTIONS.STOP,
    lightIsOn: false
}

/**
 * Send an HTTP GET request to the dimmer device.
 * @param {string} endpointPath - The endpoint to send the request to.
 * @param {function} callback - The callback function to execute when the request completes.
 */
function sendRequest(endpointPath, callback) {
    Shelly.call("http.get", { url: "http://" + (CONFIG.dimmerDevice.auth ? (CONFIG.dimmerDevice.auth + "@") : "") + CONFIG.dimmerDevice.address + "/" + endpointPath }, callback, null);
}

/**
 * Get the current light status from the dimmer device.
 * @param {function} callback - The callback function to execute when the request completes.
 */
function getLightStatus(callback) {
    sendRequest("light/0", function (response, error_code, error_message, ud) {
        let body = JSON.parse(response.body);
        DATA.lightIsOn = body.ison;
        print("getLightStatus", DATA.lightIsOn, body.brightness);
        callback();
    });
}

/**
 * Switch the light on, off, or toggle its state.
 * @param {string} action - The action to perform ("on", "off", or "toggle").
 * @param {function} callback - The callback function to execute when the request completes.
 */
function switchLight(action, callback) {
    sendRequest("light/0?turn=" + action, function (response, error_code, error_message, ud) {
        DATA.lightIsOn = action === LIGHT_ACTIONS.ON ? true : (action === LIGHT_ACTIONS.TOGGLE ? !DATA.lightIsOn : false);
        print("switchLight", action, DATA.lightIsOn);
        callback();
    });
}

/**
 * Set the brightness of the light.
 * @param {number} brightness - The brightness level to set (0-100).
 * @param {function} callback - The callback function to execute when the request completes.
 */
function setLightBrightness(brightness, callback) {
    sendRequest("light/0?brightness=" + brightness, function (response, error_code, error_message, ud) {
        print("setLightBrightness", brightness);
        callback();
    });
}

/**
 * Dim the light in the specified direction.
 * @param {string} action - The direction to dim ("up", "down", or "stop").
 * @param {function} callback - The callback function to execute when the request completes.
 */
function dimLight(action, callback) {
    sendRequest("light/0?dim=" + action + (action !== DIMMER_ACTIONS.STOP ? "&step=100" : ""), function (response, error_code, error_message, ud) {
        print("dimLight", action);
        callback();
    });
}

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
}

/**
 * Transition to a new state and execute the corresponding function.
 * @param {string} state - The new state to transition to.
 */
function transitionTo(state) {
    if (DATA.state && TRANSITIONS[DATA.state].indexOf(state) === -1) {
        return;
    }

    print("Transitioning from " + DATA.state + " to " + state);

    DATA.state = state;
    switch (state) {
        case STATES.GET_LIGHT_STATUS:
            enterGetLightStatus();
            break;
        case STATES.WAITING_FOR_LONG_PUSH:
            enterWaitingForLongPush();
            break;
        case STATES.ENSURE_LIGHT_IS_ON:
            enterEnsureLightIsOn();
            break;
        case STATES.DIMMING:
            enterDimming();
            break;
        case STATES.IDLE:
            enterIdle();
            break;
        default:
            print("Unknown state", state);
            break;
    }
}

function enterIdle() {
    DATA.inputTriggerTime = 0;
    DATA.inputAction = DIMMER_ACTIONS.STOP;
}

function enterGetLightStatus() {
    getLightStatus(function () {
        transitionTo(STATES.WAITING_FOR_LONG_PUSH);
    });
}

function enterWaitingForLongPush() {
    Timer.set(Math.max(1, CONFIG.longPushTime - Math.round(Date.now() - DATA.inputTriggerTime)), false, function () {
        transitionTo(STATES.ENSURE_LIGHT_IS_ON);
    }, null);
}

function enterEnsureLightIsOn() {
    if (!DATA.lightIsOn) {
        switchLight(LIGHT_ACTIONS.ON, function () {
            transitionTo(STATES.DIMMING);
        });
    } else {
        transitionTo(STATES.DIMMING);
    }
}

function enterDimming() {
    dimLight(DATA.inputAction, function () { });
}

function handleInputEvent(e) {
    if (CONFIG.inputMapping.hasOwnProperty(e.component)) {
        print("---> input event", e.component, e.delta.state);
        if (e.delta.state === true) {
            if (DATA.state !== STATES.IDLE) {
                transitionTo(STATES.IDLE);
            }
            DATA.inputTriggerTime = Date.now();
            DATA.inputAction = CONFIG.inputMapping[e.component];
            transitionTo(STATES.GET_LIGHT_STATUS);
        }
        else if (e.delta.state === false) {
            if (DATA.state === STATES.WAITING_FOR_LONG_PUSH || DATA.state === STATES.GET_LIGHT_STATUS) {
                switchLight(LIGHT_ACTIONS.TOGGLE, function () {
                    transitionTo(STATES.IDLE);
                });
            } else if (DATA.state === STATES.DIMMING) {
                dimLight(DIMMER_ACTIONS.STOP, function () {
                    transitionTo(STATES.IDLE);
                });
            } else {
                transitionTo(STATES.IDLE);
            }
        }
    }
}

function main() {
    transitionTo(STATES.IDLE);
    Shelly.addStatusHandler(handleInputEvent);
}

main();