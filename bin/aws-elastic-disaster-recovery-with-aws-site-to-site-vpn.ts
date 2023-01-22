#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import * as path from 'path';
import { AwsElasticDisasterRecoveryWithAwsSiteToSiteVpnStack } from '../lib/aws-elastic-disaster-recovery-with-aws-site-to-site-vpn-stack';
import { Config } from '../lib/interface';

const yaml = require('js-yaml');

const app = new cdk.App();

cdk.Tags.of(app).add('project', 'EDR-with-VPN');

function ensureString(object: { [name: string]: any }, propName: string): string {
  if (!object[propName] || object[propName].trim().length === 0)
    throw new Error(propName + ' does not exist or is empty');
  return object[propName];
}

function ensureNumber(object: { [name: string]: any }, propName: string): number {
  return object[propName];
}

function validateConfig() {
  let env = app.node.tryGetContext('config');
  if (!env) {
    console.warn(
      "\nNo configuration provided. Use a configuration file from the 'config' directory using the '-c config=[filename]' argument\n"
    );
  }
}

function getBuildConfig() {
  let config = app.node.tryGetContext('config');
  if (!config) {
    config = 'parameters';
  }
  let unparsedEnv = yaml.load(fs.readFileSync(path.resolve('./config/' + config + '.yaml'), 'utf8'));
  let buildConfig: Config = {
    appName: ensureString(unparsedEnv, 'AppName'),
    awsCidrRange: ensureString(unparsedEnv, 'AWSSideVPC'),
    onPremiseCidrRange: ensureString(unparsedEnv, 'OnPremiseSideVPC'),
    numberOfAZs: ensureNumber(unparsedEnv, 'NumberOfAZs'),
  };
  return buildConfig;
}

validateConfig();
const buildConfig = getBuildConfig();

// CDK Default Environment - default account and region
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION;
new AwsElasticDisasterRecoveryWithAwsSiteToSiteVpnStack(
  app,
  'AwsElasticDisasterRecoveryWithAwsSiteToSiteVpnStack',
  buildConfig,
  {
    stackName: 'AWS-EDR-with-AWS-S2S-VPN',
    env: { account: account, region: region },
  }
);
