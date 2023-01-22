// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cdk from 'aws-cdk-lib';

export interface Config {
  appName: string;
  awsCidrRange: string;
  onPremiseCidrRange: string;
  numberOfAZs: number;
}

export interface AppResourcesProps extends cdk.NestedStackProps {
  awsCidrRange: string;
  onPremiseCidrRange: string;
  numberOfAZs: number;
  region: string;
}

export interface VpnResourcesProps extends cdk.NestedStackProps {
  awsVpc: ec2.IVpc;
  onPremiseVpc: ec2.IVpc;
  onPremiseRouterInstance: ec2.IInstance;
}
