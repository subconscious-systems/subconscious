import type { INodeProperties } from 'n8n-workflow';

export const runCreateDescription: INodeProperties[] = [
	{
		displayName: 'Engine',
		name: 'engine',
		type: 'options',
		required: true,
		options: [
			{
				name: 'TIM-GPT (Recommended)',
				value: 'tim-gpt',
				description: 'Complex reasoning engine backed by GPT-4.1',
			},
			{
				name: 'TIM-Edge',
				value: 'tim-edge',
				description: 'Highly efficient engine tuned for performance with tools',
			},
			{
				name: 'TIM-GPT-Heavy',
				value: 'tim-gpt-heavy',
				description: 'Most powerful engine backed by GPT-5.2',
			},
		],
		default: 'tim-gpt',
		description: 'The AI engine to use for this run',
	},
	{
		displayName: 'Instructions',
		name: 'instructions',
		type: 'string',
		typeOptions: {
			rows: 4,
		},
		required: true,
		default: '',
		description: 'The instructions for the agent to execute',
		placeholder: 'e.g., Search for the latest news about AI and summarize the top 3 stories',
	},
	{
		displayName: 'Platform Tools',
		name: 'platformTools',
		type: 'multiOptions',
		options: [
			{
				name: 'Exa Crawl',
				value: 'exa_crawl',
				description: 'Retrieve full webpage content',
			},
			{
				name: 'Exa Find Similar',
				value: 'exa_find_similar',
				description: 'Find pages similar to a given URL',
			},
			{
				name: 'Exa Search',
				value: 'exa_search',
				description: 'Semantic search for high-quality content',
			},
			{
				name: 'Parallel Extract',
				value: 'parallel_extract',
				description: 'Extract specific content from a webpage',
			},
			{
				name: 'Parallel Search',
				value: 'parallel_search',
				description: 'Precision search for facts from authoritative sources',
			},
			{
				name: 'Web Search',
				value: 'web_search',
				description: 'Search the web for information using Google',
			},
			{
				name: 'Webpage Understanding',
				value: 'webpage_understanding',
				description: 'Extract and summarize webpage content',
			},
		],
		default: ['web_search'],
		description: 'Built-in tools the agent can use during execution',
	},
	{
		displayName: 'Additional Options',
		name: 'additionalOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Answer Format (JSON Schema)',
				name: 'answerFormat',
				type: 'json',
				default:
					'{\n  "type": "object",\n  "title": "...",\n  "properties": {\n    "property_name": {\n      "type": "array",\n      "items": { "type": "string" },\n      "description": "..."\n    },\n    "property_name2": {\n      "type": "string",\n      "description": "..."\n    }\n  },\n  "required": ["property_name", "property_name2"]\n}',
				description: 'JSON Schema to enforce structured output',
			},
			{
				displayName: 'Custom Tools (JSON)',
				name: 'customTools',
				type: 'json',
				default:
					'[\n  {\n    "type": "function",\n    "name": "...",\n    "description": "...",\n    "url": "https://...",\n    "method": "POST",\n    "parameters": { "type": "object", "properties": {} }\n  }\n]',
				description: 'Custom function tools as JSON array',
			},
			{
				displayName: 'Polling Interval (Ms)',
				name: 'pollingInterval',
				type: 'number',
				default: 2000,
				description: 'How often to check for run completion (in milliseconds)',
			},
			{
				displayName: 'Reasoning Format (JSON Schema)',
				name: 'reasoningFormat',
				type: 'json',
				default:
					'{\n  "type": "object",\n  "properties": {\n    "steps": { "type": "array", "items": { "type": "string" } },\n    "conclusion": { "type": "string" }\n  },\n  "required": ["..."],\n  "additionalProperties": false\n}',
				description: 'JSON Schema for reasoning output',
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeout',
				type: 'number',
				default: 300,
				description: 'Maximum time to wait for run completion (1-3600 seconds)',
				typeOptions: {
					minValue: 1,
					maxValue: 3600,
				},
			},
		],
	},
];
