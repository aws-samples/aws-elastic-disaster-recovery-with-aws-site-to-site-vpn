// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { CfnOutput, Fn} from 'aws-cdk-lib';
import { AwsSideNestedStack } from './aws-side-nested-stack';
import { OnPremiseSideNestedStack } from './on-premise-side-nested-stack';
import { VpnNestedStack } from './vpn-nested-stack';
import { Config } from './interface';

export class AwsElasticDisasterRecoveryWithAwsSiteToSiteVpnStack extends cdk.Stack {
  constructor(scope: Construct, id: string, buildConfig: Config, props?: cdk.StackProps) {
    super(scope, id, props);

    const awsSideStack = new AwsSideNestedStack(this, 'AwsSideStack', {
      awsCidrRange: buildConfig.awsCidrRange,
      onPremiseCidrRange: buildConfig.onPremiseCidrRange,
      numberOfAZs: buildConfig.numberOfAZs,
      region: this.region,
    });

    const onPremiseSideStack = new OnPremiseSideNestedStack(this, 'OnPremiseSideStack', {
      awsCidrRange: buildConfig.awsCidrRange,
      onPremiseCidrRange: buildConfig.onPremiseCidrRange,
      numberOfAZs: buildConfig.numberOfAZs,
      region: this.region,
    });

    const vpnStack = new VpnNestedStack(this, 'VpnStack', {
      awsVpc: awsSideStack.vpc,
      onPremiseVpc: onPremiseSideStack.vpc,
      onPremiseRouterInstance: onPremiseSideStack.routerInstance,
    });

    // Outputs
    new CfnOutput(this, 'AWS CIDR', { value: buildConfig.awsCidrRange });
    new CfnOutput(this, 'AWS Server Private IP', { value: awsSideStack.awsInstance.instancePrivateIp });

    new CfnOutput(this, 'On-Premise CIDR', { value: buildConfig.onPremiseCidrRange });
    new CfnOutput(this, 'On-Premise Router Public IP', { value: onPremiseSideStack.routerInstance.instancePublicIp });
    new CfnOutput(this, 'On-Premise Router Private IP', { value: onPremiseSideStack.routerInstance.instancePrivateIp });
    new CfnOutput(this, 'On-Premise Server Private IP', { value: onPremiseSideStack.privateInstance.instancePrivateIp });

    new CfnOutput(this, 'Region', { value: this.region });
  }
}
