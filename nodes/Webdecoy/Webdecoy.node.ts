import {
	NodeConnectionTypes,
	NodeOperationError,
	NodeApiError,
	type JsonObject,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

const api = 'https://api.webdecoy.com/api/automation/v1';
const search = { resource: ['detection'] };

export class Webdecoy implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WebDecoy',
		name: 'webdecoy',
		icon: { light: 'file:webdecoy.svg', dark: 'file:webdecoy.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read AI and bot detection events and actor evidence',
		defaults: { name: 'WebDecoy' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'webdecoyApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Actor', value: 'actor' },
					{ name: 'Detection', value: 'detection' },
				],
				default: 'detection',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: search },
				options: [
					{
						name: 'Get Many',
						value: 'getMany',
						action: 'Get many detections',
						description: 'Read detection events for the site bound to your key',
					},
				],
				default: 'getMany',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['actor'] } },
				options: [
					{
						name: 'Get Evidence',
						value: 'getEvidence',
						action: 'Get actor evidence',
						description: 'Read up to 20 recent detections for this actor on your site',
					},
				],
				default: 'getEvidence',
			},
			{
				displayName: 'Actor ID',
				name: 'actorId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['actor'] } },
				description: 'Actor UUID from a WebDecoy detection event',
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				displayOptions: { show: search },
				description: 'Whether to return all matching events in the selected time window',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 1000 },
				displayOptions: { show: { ...search, returnAll: [false] } },
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: search },
				options: [
					{
						displayName: 'Actor ID',
						name: 'actorId',
						type: 'string',
						default: '',
						description: 'Only events correlated to this actor UUID',
					},
					{
						displayName: 'Category',
						name: 'category',
						type: 'options',
						default: 'bot',
						options: [
							{ name: 'Attacker', value: 'attacker' },
							{ name: 'Bot', value: 'bot' },
							{ name: 'Crawler', value: 'crawler' },
							{ name: 'Legitimate', value: 'legitimate' },
							{ name: 'Scanner', value: 'scanner' },
							{ name: 'Scraper', value: 'scraper' },
						],
					},
					{
						displayName: 'Include Test Events',
						name: 'includeTests',
						type: 'boolean',
						default: false,
						description: 'Whether to include events marked as tests',
					},
					{
						displayName: 'Minimum Score',
						name: 'minScore',
						type: 'number',
						default: 70,
						typeOptions: { minValue: 0, maxValue: 100 },
					},
					{
						displayName: 'Since',
						name: 'since',
						type: 'dateTime',
						default: '',
						description:
							'Start of window. Defaults to 24 hours before Until. Maximum window is 31 days.',
					},
					{
						displayName: 'Until',
						name: 'until',
						type: 'dateTime',
						default: '',
						description:
							'End of window. Defaults to execution time and stays fixed during pagination.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				if (resource === 'actor') {
					const id = this.getNodeParameter('actorId', i) as string;
					if (!isUuid(id))
						throw new NodeOperationError(this.getNode(), 'Enter a valid actor UUID', {
							itemIndex: i,
						});
					const result = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'webdecoyApi',
						{
							method: 'GET',
							url: `${api}/actors/${encodeURIComponent(id)}`,
							json: true,
							timeout: 30000,
						},
					)) as IDataObject;
					output.push({ json: result, pairedItem: { item: i } });
				} else if (resource === 'detection') {
					const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
					const limit = returnAll
						? Number.POSITIVE_INFINITY
						: (this.getNodeParameter('limit', i) as number);
					if (!returnAll && (!Number.isInteger(limit) || limit < 1 || limit > 1000))
						throw new NodeOperationError(
							this.getNode(),
							'Limit must be an integer from 1 to 1000',
							{ itemIndex: i },
						);
					const filters = this.getNodeParameter('filters', i) as IDataObject;
					const until = filters.until ? new Date(filters.until as string) : new Date();
					const since = filters.since
						? new Date(filters.since as string)
						: new Date(until.getTime() - 86400000);
					if (
						!Number.isFinite(until.getTime()) ||
						!Number.isFinite(since.getTime()) ||
						since >= until ||
						until.getTime() - since.getTime() > 31 * 86400000
					) {
						throw new NodeOperationError(
							this.getNode(),
							'Choose a valid time window of at most 31 days',
							{ itemIndex: i },
						);
					}
					if (filters.actorId && !isUuid(filters.actorId as string))
						throw new NodeOperationError(this.getNode(), 'Enter a valid actor UUID', {
							itemIndex: i,
						});
					const qs: IDataObject = { since: since.toISOString(), until: until.toISOString() };
					for (const [parameter, field] of Object.entries({
						actorId: 'actor_id',
						category: 'category',
						includeTests: 'include_tests',
						minScore: 'min_score',
					})) {
						if (filters[parameter] !== undefined && filters[parameter] !== '')
							qs[field] = filters[parameter];
					}
					let received = 0;
					const events: INodeExecutionData[] = [];
					const cursors = new Set<string>();
					do {
						qs.limit = Math.min(50, limit - received);
						const page = (await this.helpers.httpRequestWithAuthentication.call(
							this,
							'webdecoyApi',
							{
								method: 'GET',
								url: `${api}/detections`,
								qs,
								json: true,
								timeout: 30000,
							},
						)) as { detections: IDataObject[]; has_more: boolean; next_cursor?: string };
						if (!Array.isArray(page.detections))
							throw new NodeOperationError(
								this.getNode(),
								'WebDecoy returned an invalid detection response',
								{ itemIndex: i },
							);
						if (page.has_more && page.detections.length === 0)
							throw new NodeOperationError(
								this.getNode(),
								'WebDecoy returned an empty page with more results',
								{ itemIndex: i },
							);
						for (const event of page.detections.slice(0, limit - received)) {
							events.push({ json: event, pairedItem: { item: i } });
							received++;
						}
						if (!page.has_more || received >= limit) break;
						// Cursor is a server-encoded string, never a URL. Keep requests on the
						// fixed API origin and fail if the service repeats or omits a cursor.
						const cursor = page.next_cursor;
						if (typeof cursor !== 'string' || cursor.length === 0 || cursors.has(cursor)) {
							throw new NodeOperationError(
								this.getNode(),
								'WebDecoy returned an invalid pagination cursor',
								{ itemIndex: i },
							);
						}
						cursors.add(cursor);
						qs.cursor = cursor;
						await new Promise((resolve) => setTimeout(resolve, 1000));
					} while (received < limit);
					output.push(...events);
				} else {
					throw new NodeOperationError(this.getNode(), 'Unsupported resource', { itemIndex: i });
				}
			} catch (error) {
				if (!this.continueOnFail()) {
					if (error instanceof NodeOperationError)
						throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
					throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
				}
				output.push({ json: { error: error.message }, pairedItem: { item: i } });
			}
		}
		return [output];
	}
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
