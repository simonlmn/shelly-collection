// Configuration settings for the dimmer device
let CONFIG = {
    dimmerDevice: "http://192.168.3.127/",
    minimumBrightness: 25,
    longPushTime: 500,
    updateInterval: 250,
    dimmerStep: 2,
};

// Constants for dimmer actions
const DIMMER_ACTIONS = {
    STOP: "stop",
    BRIGHTEN: "brighten",
    DARKEN: "darken"
};

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

// Data object to hold the current state and other relevant information
let DATA = {
    timerHandle: null,
    inputTriggerTime: 0,
    state: STATES.IDLE,
    dimmerAction: DIMMER_ACTIONS.STOP,
    lightIsOn: false,
    brightness: CONFIG.minimumBrightness
}

/**
 * Transition to a new state and execute the corresponding function.
 * @param {string} state - The new state to transition to.
 */
function transitionTo(state) {
    if (TRANSITIONS[DATA.state].indexOf(state) === -1) {
        return;
    }

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

/**
 * Send an HTTP GET request to the dimmer device.
 * @param {string} url - The URL to send the request to.
 * @param {function} callback - The callback function to execute when the request completes.
 */
function sendRequest(url, callback) {
    Shelly.call("http.get", { url: CONFIG.dimmerDevice + url }, callback, null);
}

/**
 * Get the current light status from the dimmer device.
 * @param {function} callback - The callback function to execute when the request completes.
 */
function getLightStatus(callback) {
    sendRequest("light/0", function (response, error_code, error_message, ud) {
        let body = JSON.parse(response.body);
        DATA.lightIsOn = body.ison;
        DATA.brightness = body.brightness;
        print("finished getLightStatus", DATA.lightIsOn, DATA.brightness);
        callback();
    });
}

/**
 * Switch the light on, off, or toggle its state.
 * @param {string} turn - The action to perform ("on", "off", or "toggle").
 * @param {function} callback - The callback function to execute when the request completes.
 */
function switchLight(turn, callback) {
    sendRequest("light/0/set?turn=" + turn, function (response, error_code, error_message, ud) {
        DATA.lightIsOn = turn === "on" ? true : (turn === "toggle" ? !DATA.lightIsOn : false);
        print("finished switchLight", turn, DATA.lightIsOn, DATA.brightness);
        callback();
    });
}

/**
 * Set the brightness of the light.
 * @param {number} brightness - The brightness level to set (0-100).
 * @param {function} callback - The callback function to execute when the request completes.
 */
function setLightBrightness(brightness, callback) {
    sendRequest("light/0/set?brightness=" + brightness, function (response, error_code, error_message, ud) {
        DATA.brightness = brightness;
        print("finished setLightBrightness", DATA.lightIsOn, DATA.brightness);
        callback();
    });
}

/**
 * Enter the idle state, clearing any timers and resetting relevant data.
 */
function enterIdle() {
    Timer.clear(DATA.timerHandle);
    DATA.inputTriggerTime = 0;
    DATA.dimmerAction = "stop";
}

/**
 * Enter the state to get the light status.
 */
function enterGetLightStatus() {
    getLightStatus(function () {
        transitionTo(STATES.WAITING_FOR_LONG_PUSH);
    });
}

/**
 * Enter the state to wait for a long push.
 */
function enterWaitingForLongPush() {
    Timer.set(Math.max(1, CONFIG.longPushTime - Math.round(Date.now() - DATA.inputTriggerTime)), false, function () {
        transitionTo(STATES.ENSURE_LIGHT_IS_ON);
    }, null);
}

/**
 * Enter the state to ensure the light is on.
 */
function enterEnsureLightIsOn() {
    if (!DATA.lightIsOn) {
        switchLight("on", function () {
            transitionTo(STATES.DIMMING);
        });
    } else {
        transitionTo(STATES.DIMMING);
    }
}

/**
 * Enter the dimming state, starting the dimming loop.
 */
function enterDimming() {
    Timer.clear(DATA.timerHandle);
    DATA.timerHandle = Timer.set(CONFIG.updateInterval, true, dimmingLoop, null);
}

/**
 * The dimming loop, adjusting the brightness based on the dimmer action.
 */
function dimmingLoop() {
    let previousBrightness = DATA.brightness;
    if (DATA.dimmerAction === "brighten") {
        DATA.brightness += CONFIG.dimmerStep;
    } else if (DATA.dimmerAction === "darken") {
        DATA.brightness -= CONFIG.dimmerStep;
    } else {
        return;
    }

    DATA.brightness = Math.max(CONFIG.minimumBrightness, Math.min(100, DATA.brightness));

    if (DATA.brightness != previousBrightness) {
        setLightBrightness(DATA.brightness, function () { });
    } else {
        transitionTo(STATES.IDLE);
    }
}

/**
 * Handle status changes from the Shelly device.
 * @param {object} e - The event object containing the status change information.
 */
Shelly.addStatusHandler(function (e) {
    if (e.component === "input:0" || e.component === "input:1") {
        if (e.delta.state === true) {
            if (DATA.state !== STATES.IDLE) {
                transitionTo(STATES.IDLE);
            }
            DATA.inputTriggerTime = Date.now();
            DATA.dimmerAction = e.component === "input:1" ? "brighten" : "darken";
            transitionTo(STATES.GET_LIGHT_STATUS);
        }
        else if (e.delta.state === false) {
            if (DATA.state === STATES.WAITING_FOR_LONG_PUSH) {
                transitionTo(STATES.IDLE);
                switchLight("toggle", function () { });
            }
        }
    }
});