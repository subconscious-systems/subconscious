import type {
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IDataObject,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

const BASE_URL = 'https://api.subconscious.dev/v1';

const TERMINAL_STATUSES = ['succeeded', 'failed', 'canceled', 'timed_out'];

export interface SubconsciousRun {
	runId: string;
	status?: string;
	result?: {
		answer: string;
		reasoning?: unknown;
	};
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		durationMs?: number;
	};
	error?: unknown;
}

export interface Tool {
	type: 'platform' | 'function' | 'mcp';
	id?: string;
	options?: Record<string, unknown>;
	[key: string]: unknown;
}

export async function subconsciousApiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<unknown> {
	const credentials = await this.getCredentials('subconsciousApi');

	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${endpoint}`,
		headers: {
			Authorization: `Bearer ${credentials.apiKey}`,
			'Content-Type': 'application/json',
		},
		json: true,
	};

	if (body && Object.keys(body).length > 0) {
		options.body = body;
	}

	if (qs && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	try {
		return await this.helpers.httpRequest(options);
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject, {
			message: 'Subconscious API request failed',
		});
	}
}

export async function pollRunUntilComplete(
	this: IExecuteFunctions,
	runId: string,
	intervalMs: number = 2000,
	timeoutSeconds: number = 300,
): Promise<SubconsciousRun> {
	const startTime = Date.now();
	const maxWaitMs = timeoutSeconds * 1000;

	while (true) {
		const run = (await subconsciousApiRequest.call(
			this,
			'GET',
			`/runs/${runId}`,
		)) as SubconsciousRun;

		if (run.status && TERMINAL_STATUSES.includes(run.status)) {
			return run;
		}

		const elapsed = Date.now() - startTime;
		if (elapsed >= maxWaitMs) {
			throw new Error(
				`Run ${runId} did not complete within ${timeoutSeconds} seconds. Last status: ${run.status}`,
			);
		}

		// Wait before polling again
		await sleep(intervalMs);
	}
}

async function sleep(ms: number): Promise<void> {
	// Use a promise-based delay without setTimeout for n8n compatibility
	await new Promise<void>((resolve) => {
		const start = Date.now();
		const check = (): void => {
			if (Date.now() - start >= ms) {
				resolve();
			} else {
				// Use setImmediate-like behavior with Promise.resolve
				void Promise.resolve().then(check);
			}
		};
		check();
	});
}

export function buildToolsArray(
	platformTools: string[],
	customToolsJson?: string,
): Tool[] {
	const tools: Tool[] = [];

	// Add platform tools
	if (platformTools && platformTools.length > 0) {
		for (const toolId of platformTools) {
			tools.push({
				type: 'platform',
				id: toolId,
				options: {},
			});
		}
	}

	// Parse and add custom tools
	if (customToolsJson && customToolsJson.trim()) {
		try {
			const customTools = JSON.parse(customToolsJson);
			if (Array.isArray(customTools)) {
				tools.push(...customTools);
			}
		} catch {
			throw new Error('Custom Tools JSON is not valid JSON');
		}
	}

	return tools;
}

export function parseJsonField(jsonString: string | undefined, fieldName: string): unknown {
	if (!jsonString || !jsonString.trim()) {
		return undefined;
	}

	try {
		return JSON.parse(jsonString);
	} catch {
		throw new Error(`${fieldName} is not valid JSON`);
	}
}
