import { ApiCore, RequestOptions } from '../ApiCore';

function requireId(value: string | number, name: string): string {
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
  return encodeURIComponent(String(value));
}

/**
 * Service quotas (reseller APIs). These are available through the library only;
 * the CLI exposes list/get/update.
 */
export class ServiceQuotas {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  list(query: Record<string, unknown> = {}, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/serviceQuotas', { ...reqOptions, query: query as RequestOptions['query'] });
  }

  create(body: unknown, reqOptions: RequestOptions = {}) {
    if (!body) throw new Error('body is required');
    return this.api.request('POST', '/cdn/serviceQuotas', { ...reqOptions, body });
  }

  get(serviceQuotaId: string, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/serviceQuotas/${requireId(serviceQuotaId, 'serviceQuotaId')}`, reqOptions);
  }

  update(serviceQuotaId: string, patchBody: unknown, reqOptions: RequestOptions = {}) {
    const id = requireId(serviceQuotaId, 'serviceQuotaId');
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/serviceQuotas/${id}`, { ...reqOptions, body: patchBody });
  }

  delete(serviceQuotaId: string, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/serviceQuotas/${requireId(serviceQuotaId, 'serviceQuotaId')}`, reqOptions);
  }

  getByCustomer(customerId: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request('GET', `/cdn/serviceQuotas/customer/${requireId(customerId, 'customerId')}`, reqOptions);
  }

  updateByCustomer(customerId: string | number, patchBody: unknown, reqOptions: RequestOptions = {}) {
    const id = requireId(customerId, 'customerId');
    if (!patchBody) throw new Error('patchBody is required');
    return this.api.request('PATCH', `/cdn/serviceQuotas/customer/${id}`, { ...reqOptions, body: patchBody });
  }

  deleteByCustomer(customerId: string | number, reqOptions: RequestOptions = {}) {
    return this.api.request('DELETE', `/cdn/serviceQuotas/customer/${requireId(customerId, 'customerId')}`, reqOptions);
  }
}
