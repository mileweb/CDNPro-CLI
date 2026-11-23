import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class Properties {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/properties', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(propertyID: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/properties/${pathSegment(propertyID, 'propertyID')}`, reqOptions);
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/properties', { ...reqOptions, body });
  }

  update(propertyID: string, patchBody: unknown, reqOptions: RequestOptions = {}) {
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/properties/${pathSegment(propertyID, 'propertyID')}`, { ...reqOptions, body: patchBody });
  }

  delete(propertyID: string, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/properties/${pathSegment(propertyID, 'propertyID')}`, reqOptions);
  }

  listVersions(propertyID: string, query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/properties/${pathSegment(propertyID, 'propertyID')}/versions`, { ...reqOptions, query: query as RequestOptions['query'] });
  }

  createVersion(propertyID: string, body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', `/cdn/properties/${pathSegment(propertyID, 'propertyID')}/versions`, { ...reqOptions, body });
  }

  getVersion(propertyID: string, version: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request(
      'GET',
      `/cdn/properties/${pathSegment(propertyID, 'propertyID')}/versions/${pathSegment(version, 'version')}`,
      reqOptions,
    );
  }

  patchVersion(propertyID: string, version: string | number, body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request(
      'PATCH',
      `/cdn/properties/${pathSegment(propertyID, 'propertyID')}/versions/${pathSegment(version, 'version')}`,
      { ...reqOptions, body },
    );
  }

  deleteVersion(propertyID: string, version: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request(
      'DELETE',
      `/cdn/properties/${pathSegment(propertyID, 'propertyID')}/versions/${pathSegment(version, 'version')}`,
      reqOptions,
    );
  }
}
