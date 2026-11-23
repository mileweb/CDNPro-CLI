import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class ApiAccounts {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/ngadmin/apiAccounts', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(id: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/ngadmin/apiAccounts/${pathSegment(id, 'id')}`, reqOptions);
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/ngadmin/apiAccounts', { ...reqOptions, body });
  }

  update(id: string | number, patchBody: unknown, reqOptions: RequestOptions = {}) {
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/ngadmin/apiAccounts/${pathSegment(id, 'id')}`, { ...reqOptions, body: patchBody });
  }

  delete(id: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/ngadmin/apiAccounts/${pathSegment(id, 'id')}`, reqOptions);
  }
}
