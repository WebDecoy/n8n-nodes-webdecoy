import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WebdecoyApi implements ICredentialType {
	name = 'webdecoyApi';

	displayName = 'WebDecoy API';
	icon = {
		light: 'file:../nodes/Webdecoy/webdecoy.svg',
		dark: 'file:../nodes/Webdecoy/webdecoy.dark.svg',
	} as const;

	// Link to your community node's README
	documentationUrl = 'https://github.com/WebDecoy/n8n-nodes-webdecoy#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.webdecoy.com/api/automation/v1',
			url: '/connection',
		},
	};
}
