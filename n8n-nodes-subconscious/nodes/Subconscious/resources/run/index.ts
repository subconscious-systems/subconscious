import type { INodeProperties } from 'n8n-workflow';
import { runCreateDescription } from './create';

export const runDescription: INodeProperties[] = [
	...runCreateDescription,
];
