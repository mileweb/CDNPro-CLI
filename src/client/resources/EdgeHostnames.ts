import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class EdgeHostnames {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/edgeHostnames', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(edgeHostname: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/edgeHostnames/${pathSegment(edgeHostname, 'edgeHostname')}`, reqOptions);
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/edgeHostnames', { ...reqOptions, body });
  }

  replace(edgeHostname: string, body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('PUT', `/cdn/edgeHostnames/${pathSegment(edgeHostname, 'edgeHostname')}`, { ...reqOptions, body });
  }

  update(edgeHostname: string, patchBody: unknown, reqOptions: RequestOptions = {}) {
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/edgeHostnames/${pathSegment(edgeHostname, 'edgeHostname')}`, { ...reqOptions, body: patchBody });
  }

  delete(edgeHostname: string, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/edgeHostnames/${pathSegment(edgeHostname, 'edgeHostname')}`, reqOptions);
  }
}
