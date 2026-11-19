const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Webdecoy } = require('../dist/nodes/Webdecoy/Webdecoy.node.js');
const { WebdecoyApi } = require('../dist/credentials/WebdecoyApi.credentials.js');
let server, address, requests, respond;
before(async () => {
	server = http.createServer((req, res) => {
		assert.equal(req.headers.authorization, 'Bearer sk_live_fixture_only');
		const url = new URL(req.url, 'http://fixture');
		requests.push(url);
		const result = respond(url);
		res.writeHead(result.status || 200, { 'content-type': 'application/json' });
		res.end(JSON.stringify(result.body));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	address = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
function context(parameters, keepGoing = false, count = 1) {
	return {
		getInputData: () => Array.from({ length: count }, () => ({ json: {} })),
		getNodeParameter: (name, index) =>
			typeof parameters[name] === 'function' ? parameters[name](index) : parameters[name],
		getNode: () => ({
			name: 'WebDecoy',
			type: 'n8n-nodes-webdecoy.webdecoy',
			typeVersion: 1,
			position: [0, 0],
			parameters,
		}),
		continueOnFail: () => keepGoing,
		helpers: {
			httpRequestWithAuthentication: async function (name, options) {
				assert.equal(name, 'webdecoyApi');
				assert.match(options.url, /^https:\/\/api\.webdecoy\.com\/api\/automation\/v1\//);
				assert.equal(options.method, 'GET');
				assert.equal(options.timeout, 30000);
				const url = new URL(address + new URL(options.url).pathname);
				for (const [key, value] of Object.entries(options.qs || {}))
					url.searchParams.set(key, String(value));
				const response = await fetch(url, {
					headers: { authorization: 'Bearer sk_live_fixture_only' },
				});
				const data = await response.json();
				if (!response.ok)
					throw Object.assign(new Error(data.error), {
						statusCode: response.status,
						message: data.error,
					});
				return data;
			},
		},
	};
}
const defaults = { resource: 'detection', operation: 'getMany', limit: 60, filters: {} };
const event = (id) => ({ id, score: 80, actor_id: '4b231b78-4e34-45c9-b5c4-14de5578de80' });
function reset(fn) {
	requests = [];
	respond = fn;
}
test('pages through actual HTTP responses, fixes the time window and respects total limit', async () => {
	reset((url) => ({
		body: {
			detections: Array.from({ length: Number(url.searchParams.get('limit')) }, (_, i) =>
				event(`${requests.length}-${i}`),
			),
			has_more: true,
			next_cursor: 'next',
		},
	}));
	const [items] = await new Webdecoy().execute.call(context(defaults));
	assert.equal(items.length, 60);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].searchParams.get('limit'), '50');
	assert.equal(requests[1].searchParams.get('limit'), '10');
	assert.equal(requests[0].searchParams.get('until'), requests[1].searchParams.get('until'));
	assert.equal(requests[0].searchParams.get('since'), requests[1].searchParams.get('since'));
	assert.equal(requests[1].searchParams.get('cursor'), 'next');
	assert.deepEqual(items[59].pairedItem, { item: 0 });
});
test('preserves zero score and false test-event filter', async () => {
	reset(() => ({ body: { detections: [], has_more: false } }));
	await new Webdecoy().execute.call(
		context({ ...defaults, filters: { minScore: 0, includeTests: false } }),
	);
	assert.equal(requests[0].searchParams.get('min_score'), '0');
	assert.equal(requests[0].searchParams.get('include_tests'), 'false');
});
test('returns an empty result when no detections match', async () => {
	reset(() => ({ body: { detections: [], has_more: false } }));
	assert.deepEqual(await new Webdecoy().execute.call(context(defaults)), [[]]);
});
test('rejects repeated cursors rather than looping', async () => {
	reset(() => ({ body: { detections: [event('one')], has_more: true, next_cursor: 'repeat' } }));
	await assert.rejects(() => new Webdecoy().execute.call(context(defaults)), /pagination cursor/);
	assert.equal(requests.length, 2);
});
test('rejects an empty page claiming more results', async () => {
	reset(() => ({ body: { detections: [], has_more: true, next_cursor: 'next' } }));
	await assert.rejects(() => new Webdecoy().execute.call(context(defaults)), /empty/);
});
test('fails closed on malformed responses', async () => {
	reset(() => ({ body: { error: 'wrong-shape' } }));
	await assert.rejects(
		() => new Webdecoy().execute.call(context(defaults)),
		/invalid detection response/,
	);
});
test('propagates 401, 403, 429 and 503 instead of silently producing empty results', async () => {
	for (const status of [401, 403, 429, 503]) {
		reset(() => ({ status, body: { error: `fixture-${status}` } }));
		await assert.rejects(
			() => new Webdecoy().execute.call(context(defaults)),
			(error) => error.name === 'NodeApiError' && error.cause.statusCode === status,
		);
		assert.equal(requests.length, 1);
	}
});
test('continue-on-fail produces only the error item if a later page fails', async () => {
	reset(() =>
		requests.length === 1
			? { body: { detections: [event('partial')], has_more: true, next_cursor: 'next' } }
			: { status: 503, body: { error: 'service unavailable' } },
	);
	const [items] = await new Webdecoy().execute.call(context(defaults, true));
	assert.equal(items.length, 1);
	assert.match(items[0].json.error, /service unavailable/);
	assert.deepEqual(items[0].pairedItem, { item: 0 });
});
test('reads actor evidence on the fixed API origin', async () => {
	const actorId = '4b231b78-4e34-45c9-b5c4-14de5578de80';
	reset(() => ({ body: { id: actorId, recent_detections: [event('one')], has_more: false } }));
	const [items] = await new Webdecoy().execute.call(context({ resource: 'actor', actorId }));
	assert.equal(items[0].json.id, actorId);
	assert.equal(requests[0].pathname, `/api/automation/v1/actors/${actorId}`);
});
test('validates UUIDs, limits and date windows before sending requests', async () => {
	reset(() => ({ body: {} }));
	for (const p of [
		{ resource: 'actor', actorId: '../connection' },
		{ ...defaults, limit: 1001 },
		{ ...defaults, filters: { actorId: 'bad' } },
		{ ...defaults, filters: { since: 'bad' } },
		{ ...defaults, filters: { since: '2020-01-01', until: '2026-01-01' } },
	]) {
		await assert.rejects(() => new Webdecoy().execute.call(context(p)));
	}
	assert.equal(requests.length, 0);
});
test('pairs output with each input item', async () => {
	reset(() => ({ body: { detections: [event('one')], has_more: false } }));
	const [items] = await new Webdecoy().execute.call(context(defaults, false, 2));
	assert.deepEqual(
		items.map((i) => i.pairedItem),
		[{ item: 0 }, { item: 1 }],
	);
});
test('credentials use hidden API key and read-only connection test', () => {
	const credential = new WebdecoyApi();
	assert.equal(credential.properties[0].typeOptions.password, true);
	assert.equal(credential.test.request.url, '/connection');
	assert.equal(
		credential.authenticate.properties.headers.Authorization,
		'=Bearer {{$credentials.accessToken}}',
	);
});

test('Return All follows cursor pages until the service reports completion', async () => {
	reset(() => ({
		body: {
			detections: [event(String(requests.length))],
			has_more: requests.length === 1,
			next_cursor: 'next',
		},
	}));
	const [items] = await new Webdecoy().execute.call(context({ ...defaults, returnAll: true }));
	assert.equal(items.length, 2);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].searchParams.get('limit'), '50');
});

test('Slack example creates one count-only digest and never includes captured attacker text', () => {
	const workflow = require('../examples/bot-activity-slack.json');
	const code = workflow.nodes.find((node) => node.name === 'Build activity digest').parameters
		.jsCode;
	const run = new Function('$input', code);
	assert.deepEqual(run({ all: () => [] }), []);
	const result = run({
		all: () => [{ json: { user_agent: '<!channel> malicious' } }, { json: {} }],
	});
	assert.equal(result.length, 1);
	assert.match(result[0].json.text, /2 detection events/);
	assert.doesNotMatch(result[0].json.text, /malicious|<!channel>/);
	assert.equal(workflow.active, false);
	assert.ok(workflow.nodes.every((node) => !node.credentials));
});
