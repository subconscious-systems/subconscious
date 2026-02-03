import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SubconsciousApi implements ICredentialType {
	name = 'subconsciousApi';

	displayName = 'Subconscious API';

	documentationUrl = 'https://docs.subconscious.dev';

	icon = {
		light: 'file:../nodes/Subconscious/subconscious.svg',
		dark: 'file:../nodes/Subconscious/subconscious.dark.svg',
	} as const;

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Your Subconscious API key from the dashboard at subconscious.dev/platform',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.subconscious.dev/v1',
			url: '/runs',
			method: 'GET',
			qs: {
				limit: 1,
			},
		},
	};
}
