// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { CfnOutput, Fn, Tags } from 'aws-cdk-lib';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { AppResourcesProps } from './interface';

export class AwsSideNestedStack extends cdk.NestedStack {
  public readonly vpc: ec2.IVpc;
  public readonly awsInstance: ec2.IInstance;
  public readonly vpcS3InterfaceEndpoint: ec2.InterfaceVpcEndpoint;
  public readonly vpcEdrInterfaceEndpoint: ec2.InterfaceVpcEndpoint;

  constructor(scope: Construct, id: string, props: AppResourcesProps) {
    super(scope, id, props);

    // AWS VPC
    this.vpc = new ec2.Vpc(this, 'AwsVpc', {
      vpcName: 'AWS VPC',
      cidr: props.awsCidrRange,
      natGateways: 0,
      maxAzs: props.numberOfAZs,
    });

    // Security Group
    const awsInstanceSecurityGroup = new ec2.SecurityGroup(this, 'AwsInstanceSecurityGroup', {
      vpc: this.vpc,
    });
    awsInstanceSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.onPremiseCidrRange),
      ec2.Port.icmpPing(),
      'Allow Ping from on-premise side'
    );
    awsInstanceSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.onPremiseCidrRange),
      ec2.Port.tcp(443),
      'Allow HTTPS from on-premise side'
    );
    awsInstanceSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.onPremiseCidrRange),
      ec2.Port.tcp(1500),
      'Allow port 1500 from on-premise side (used for EDR)'
    );

    // Define role for AWS instance
    const awsInstanceEc2Role = new iam.Role(this, 'AwsInstanceEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });

    // EC2 instance
    this.awsInstance = new ec2.Instance(this, 'AwsPrivateInstance', {
      instanceName: 'AWS-side private instance',
      vpc: this.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      securityGroup: awsInstanceSecurityGroup,
      role: awsInstanceEc2Role,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // VPC endpoints in AWS VPC
    // Endpoints for Elastic Disaster Recovery
    const vpcEndpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
      vpc: this.vpc,
    });
    vpcEndpointSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.awsCidrRange),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from AWS side to interface endpoint'
    );
    vpcEndpointSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.onPremiseCidrRange),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from on-premise side to interface endpoint'
    );

    // S3 interface endpoint. Needed to install EDR agent
    this.vpcS3InterfaceEndpoint = new ec2.InterfaceVpcEndpoint(this, 'AwsVpcS3InterfaceEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.s3`, 443),
      securityGroups: [vpcEndpointSecurityGroup],
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });
    Tags.of(this.vpcS3InterfaceEndpoint).add('Name', 'S3 interface endpoint');

    // EDR interface endpoint. Needed to install EDR agent
    this.vpcEdrInterfaceEndpoint = new ec2.InterfaceVpcEndpoint(this, 'AwsVpcEdrInterfaceEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.drs`, 443),
      securityGroups: [vpcEndpointSecurityGroup],
      privateDnsEnabled: true,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });
    Tags.of(this.vpcEdrInterfaceEndpoint).add('Name', 'EDR interface endpoint');

    // S3 gateway endpoint.
    const vpcS3GatewayEndpoint = new ec2.GatewayVpcEndpoint(this, 'AwsVpcS3GatewayEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.s3`, 443),
    });
    Tags.of(vpcS3GatewayEndpoint).add('Name', 'S3 gateway endpoint');

    // EC2 interface endpoint.
    const vpcEc2InterfaceEndpoint = new ec2.InterfaceVpcEndpoint(this, 'AwsVpcEc2InterfaceEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.ec2`, 443),
      securityGroups: [vpcEndpointSecurityGroup],
      privateDnsEnabled: true,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });
    Tags.of(vpcEc2InterfaceEndpoint).add('Name', 'EC2 interface endpoint');
  }
}
