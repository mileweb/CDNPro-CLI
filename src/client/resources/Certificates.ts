import { ApiCore, RequestOptions, pathSegment } from '../ApiCore';

export class Certificates {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/certificates', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  get(certificateID: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/certificates/${pathSegment(certificateID, 'certificateID')}`, reqOptions);
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/certificates', { ...reqOptions, body });
  }

  update(certificateID: string, patchBody: unknown, reqOptions: RequestOptions = {}) {
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/certificates/${pathSegment(certificateID, 'certificateID')}`, { ...reqOptions, body: patchBody });
  }

  delete(certificateID: string, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/certificates/${pathSegment(certificateID, 'certificateID')}`, reqOptions);
  }

  downloadCSR(certificateID: string, query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/certificates/${pathSegment(certificateID, 'certificateID')}/csr`, { ...reqOptions, query: query as RequestOptions['query'] });
  }

  getVersion(certificateID: string, version: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request(
      'GET',
      `/cdn/certificates/${pathSegment(certificateID, 'certificateID')}/versions/${pathSegment(version, 'version')}`,
      reqOptions,
    );
  }

  deleteVersion(certificateID: string, version: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request(
      'DELETE',
      `/cdn/certificates/${pathSegment(certificateID, 'certificateID')}/versions/${pathSegment(version, 'version')}`,
      reqOptions,
    );
  }
}
