import { ApiCore, RequestOptions } from '../ApiCore';

export class SystemConfigs {
  private api: ApiCore;

  constructor(apiCore: ApiCore) {
    this.api = apiCore;
  }

  get(reqOptions: RequestOptions = {}) {
    return this.api.request('GET', '/cdn/systemConfigs', reqOptions);
  }
}
