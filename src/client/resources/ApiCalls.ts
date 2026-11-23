import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class ApiCalls {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/ngadmin/apicalls', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  counts(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/ngadmin/apicalls/counts', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(id: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/ngadmin/apicalls/${pathSegment(id, 'id')}`, reqOptions);
  }
}
