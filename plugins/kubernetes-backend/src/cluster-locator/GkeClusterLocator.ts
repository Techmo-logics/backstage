/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Config } from '@backstage/config';
import { ForwardedError } from '@backstage/errors';
import * as container from '@google-cloud/container';
import {
  ClusterDetails,
  GKEClusterDetails,
  KubernetesClustersSupplier,
} from '../types/types';

type GkeClusterLocatorOptions = {
  projectId: string;
  region?: string;
  skipTLSVerify?: boolean;
  skipMetricsLookup?: boolean;
  exposeDashboard?: boolean;
};

export class GkeClusterLocator implements KubernetesClustersSupplier {
  constructor(
    private readonly options: GkeClusterLocatorOptions,
    private readonly client: container.v1.ClusterManagerClient,
    private clusterDetails: GKEClusterDetails[] | undefined = undefined,
  ) {}

  static fromConfigWithClient(
    config: Config,
    client: container.v1.ClusterManagerClient,
  ): GkeClusterLocator {
    const options = {
      projectId: config.getString('projectId'),
      region: config.getOptionalString('region') ?? '-',
      skipTLSVerify: config.getOptionalBoolean('skipTLSVerify') ?? false,
      skipMetricsLookup:
        config.getOptionalBoolean('skipMetricsLookup') ?? false,
      exposeDashboard: config.getOptionalBoolean('exposeDashboard') ?? false,
    };
    return new GkeClusterLocator(options, client);
  }

  static fromConfig(config: Config): GkeClusterLocator {
    return GkeClusterLocator.fromConfigWithClient(
      config,
      new container.v1.ClusterManagerClient(),
    );
  }

  async getClusters(): Promise<ClusterDetails[]> {
    if (this.clusterDetails) {
      return this.clusterDetails;
    }

    this.clusterDetails = await this.retrieveClusters();
    return this.clusterDetails;
  }

  // TODO pass caData into the object
  async retrieveClusters(): Promise<GKEClusterDetails[]> {
    const {
      projectId,
      region,
      skipTLSVerify,
      skipMetricsLookup,
      exposeDashboard,
    } = this.options;
    const request = {
      parent: `projects/${projectId}/locations/${region}`,
    };

    try {
      const [response] = await this.client.listClusters(request);
      return (response.clusters ?? []).map(r => ({
        // TODO filter out clusters which don't have name or endpoint
        name: r.name ?? 'unknown',
        url: `https://${r.endpoint ?? ''}`,
        authProvider: 'google',
        skipTLSVerify,
        skipMetricsLookup,
        ...(exposeDashboard
          ? {
              dashboardApp: 'gke',
              dashboardParameters: {
                projectId,
                region,
                clusterName: r.name,
              },
            }
          : {}),
      }));
    } catch (e) {
      throw new ForwardedError(
        `There was an error retrieving clusters from GKE for projectId=${projectId} region=${region}`,
        e,
      );
    }
  }
}
