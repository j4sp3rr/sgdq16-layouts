'use strict';

/*
 * NOTE: It is absolutely critical that the `args` param of any udpPort.send command not be null or undefined.
 * Doing so causes the osc lib to actually encode it as a null argument (,N). Instead, use an empty array ([]).
 */

const X32_UDP_PORT = 10023;
const FADE_THRESHOLD = 0.10;
const DEFAULT_CHANNEL_OBJ = {
	sd: {muted: true, fadedBelowThreshold: true},
	hd: {muted: true, fadedBelowThreshold: true}
};

const clone = require('clone');
const osc = require('osc');

module.exports = function (nodecg) {
	const gameAudioChannels = nodecg.Replicant('gameAudioChannels', {
		defaultValue: [
			clone(DEFAULT_CHANNEL_OBJ),
			clone(DEFAULT_CHANNEL_OBJ),
			clone(DEFAULT_CHANNEL_OBJ),
			clone(DEFAULT_CHANNEL_OBJ)
		],
		persistent: false
	});

	if (!nodecg.bundleConfig.osc || Object.keys(nodecg.bundleConfig.osc).length === 0) {
		nodecg.log.error('"osc" is not defined in cfg/sgdq16-layouts.json! ' +
			'Behringer X32 OSC integration will be disabled.');
		return;
	}

	const channelToReplicantMap = {};
	nodecg.bundleConfig.osc.gameAudioChannels.forEach((item, index) => {
		if (typeof item.sd === 'number') {
			channelToReplicantMap[item.sd] = gameAudioChannels.value[index].sd;
		}

		if (typeof item.hd === 'number') {
			channelToReplicantMap[item.hd] = gameAudioChannels.value[index].hd;
		}
	});

	const udpPort = new osc.UDPPort({
		localAddress: '0.0.0.0',
		localPort: 52361,
		remoteAddress: nodecg.bundleConfig.osc.address,
		remotePort: X32_UDP_PORT,
		metadata: true
	});

	udpPort.on('raw', buf => {
		const str = buf.toString('ascii');
		const valueArray = [];
		let channelNumber = 0;
		let valueBytes;
		let replicantObject;

		if (str.indexOf('/chMutes') === 0) {
			// For this particular message, we know that the values start at byte 21 and stop 3 bytes from the end.
			valueBytes = buf.slice(21, -3);

			for (let i = 0; i < valueBytes.length; i += 4) {
				const muted = !valueBytes.readFloatBE(i);
				valueArray.push(muted);

				replicantObject = channelToReplicantMap[String(channelNumber + 1)];
				if (replicantObject) {
					replicantObject.muted = muted;
				}

				channelNumber++;
			}
		} else if (str.indexOf('/chFaders') === 0) {
			// For this particular message, we know that the values start at byte 24
			valueBytes = buf.slice(24);

			for (let i = 0; i < valueBytes.length; i += 4) {
				const fadedBelowThreshold = valueBytes.readFloatLE(i) < FADE_THRESHOLD;
				valueArray.push(fadedBelowThreshold);

				replicantObject = channelToReplicantMap[String(channelNumber + 1)];
				if (replicantObject) {
					replicantObject.fadedBelowThreshold = fadedBelowThreshold;
				}

				channelNumber++;
			}
		}
	});

	udpPort.on('error', error => {
		nodecg.log.warn('[osc] Error:', error.stack);
	});

	udpPort.on('open', () => {
		nodecg.log.info('[osc] Port open, can now communicate with a Behringer X32.');
	});

	udpPort.on('close', () => {
		nodecg.log.warn('[osc] Port closed.');
	});

	// Open the socket.
	udpPort.open();

	renewSubscriptions();
	setInterval(renewSubscriptions, 10000);

	/**
	 * Renews subscriptions with the X32 (they expire every 10s).
	 * @returns {undefined}
	 */
	function renewSubscriptions() {
		udpPort.send({
			address: '/batchsubscribe',
			args: [
				// This first argument seems to define local endpoint that the X32 will send this subscription data to.
				{type: 's', value: '/chMutes'},
				{type: 's', value: '/mix/on'},
				{type: 'i', value: 0},
				{type: 'i', value: 63},
				{type: 'i', value: 10}
			]
		});

		udpPort.send({
			address: '/batchsubscribe',
			args: [
				// This first argument seems to define local endpoint that the X32 will send this subscription data to.
				{type: 's', value: '/chFaders'},
				{type: 's', value: '/mix/fader'},
				{type: 'i', value: 0},
				{type: 'i', value: 63},
				{type: 'i', value: 10}
			]
		});
	}
};
