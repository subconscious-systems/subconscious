import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { runDescription } from './resources/run';
import {
	subconsciousApiRequest,
	pollRunUntilComplete,
	buildToolsArray,
	parseJsonField,
	type SubconsciousRun,
} from './GenericFunctions';

export class Subconscious implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Subconscious',
		name: 'subconscious',
		icon: { light: 'file:../../icons/subconscious.svg', dark: 'file:../../icons/subconscious.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: 'Run AI Agent',
		description: 'Run AI agents with tools using the Subconscious API',
		defaults: {
			name: 'Subconscious',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'subconsciousApi', required: true }],
		properties: [...runDescription],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const responseData = await executeRunCreate.call(this, i);

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as unknown as IDataObject),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}

async function executeRunCreate(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<SubconsciousRun> {
	const engine = this.getNodeParameter('engine', itemIndex) as string;
	const instructions = this.getNodeParameter('instructions', itemIndex) as string;
	const platformTools = this.getNodeParameter('platformTools', itemIndex, []) as string[];
	const additionalOptions = this.getNodeParameter(
		'additionalOptions',
		itemIndex,
		{},
	) as IDataObject;

	// Build tools array
	const tools = buildToolsArray(platformTools, additionalOptions.customTools as string | undefined);

	// Build input object
	const input: IDataObject = {
		instructions,
	};

	if (tools.length > 0) {
		input.tools = tools;
	}

	const answerFormat = parseJsonField(
		additionalOptions.answerFormat as string | undefined,
		'Answer Format',
	);
	if (answerFormat) {
		input.answerFormat = answerFormat;
	}

	const reasoningFormat = parseJsonField(
		additionalOptions.reasoningFormat as string | undefined,
		'Reasoning Format',
	);
	if (reasoningFormat) {
		input.reasoningFormat = reasoningFormat;
	}

	// Build request body
	const body: IDataObject = {
		engine,
		input,
	};

	// Add output options
	if (additionalOptions.callbackUrl) {
		body.output = { callbackUrl: additionalOptions.callbackUrl };
	}

	// Add run options
	if (additionalOptions.timeout) {
		body.options = { timeout: additionalOptions.timeout };
	}

	// Create the run
	const createResponse = (await subconsciousApiRequest.call(
		this,
		'POST',
		'/runs',
		body,
	)) as SubconsciousRun;

	// Always wait for completion
	const pollingInterval = (additionalOptions.pollingInterval as number) || 2000;
	const timeout = (additionalOptions.timeout as number) || 300;

	return pollRunUntilComplete.call(this, createResponse.runId, pollingInterval, timeout);
}
