// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Tags } from 'aws-cdk-lib';
import { CfnRoute } from 'aws-cdk-lib/aws-ec2';
import { ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import { AppResourcesProps } from './interface';

export class OnPremiseSideNestedStack extends cdk.NestedStack {
  public readonly vpc: ec2.IVpc;
  public readonly routerInstance: ec2.IInstance;
  public readonly privateInstance: ec2.IInstance;

  constructor(scope: Construct, id: string, props: AppResourcesProps) {
    super(scope, id, props);

    // On-Premise VPC
    this.vpc = new ec2.Vpc(this, 'OnPremiseVpc', {
      vpcName: 'On-premise VPC',
      cidr: props.onPremiseCidrRange,
      natGateways: 0,
      maxAzs: props.numberOfAZs,
    });

    // Security Group
    const onPremiseInstanceSecurityGroup = new ec2.SecurityGroup(this, 'OnPremiseInstanceSecurityGroup', {
      vpc: this.vpc,
    });
    onPremiseInstanceSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.awsCidrRange),
      ec2.Port.icmpPing(),
      'Allow ping from AWS side'
    );
    onPremiseInstanceSecurityGroup.addIngressRule(
      onPremiseInstanceSecurityGroup,
      ec2.Port.allTcp(),
      'Allow all TCP traffic from within this security group'
    );
    onPremiseInstanceSecurityGroup.addIngressRule(
      onPremiseInstanceSecurityGroup,
      ec2.Port.icmpPing(),
      'Allow ping from within this security group'
    );

    // Define role for On-Premise instances
    const routerInstanceEc2Role = new iam.Role(this, 'RouterInstanceEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });

    const privateInstanceEc2Role = new iam.Role(this, 'PrivateInstanceEc2Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        ManagedPolicy.fromAwsManagedPolicyName('AWSElasticDisasterRecoveryAgentInstallationPolicy'),
        ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSElasticDisasterRecoveryEC2InstancePolicy'),
      ],
    });

    // Create EC2 instances
    this.routerInstance = new ec2.Instance(this, 'OnPremiseRouterInstance', {
      instanceName: 'On-premise router instance',
      vpc: this.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      securityGroup: onPremiseInstanceSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      role: routerInstanceEc2Role,
      sourceDestCheck: false, // so instance can forward traffic to other instances
    });

    this.privateInstance = new ec2.Instance(this, 'OnPremiseprivateInstance', {
      instanceName: 'On-premise private instance',
      vpc: this.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      securityGroup: onPremiseInstanceSecurityGroup,
      role: privateInstanceEc2Role,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    });

    // VPC Endpoints on-premise VPC
    const vpcEndpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
      vpc: this.vpc,
    });
    vpcEndpointSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(props.onPremiseCidrRange),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from on-premise side to interface endpoint'
    );

    const vpcSsmInterfaceEndpoint = new ec2.InterfaceVpcEndpoint(this, 'OnPremiseVpcSsmInterfaceEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.ssm`, 443),
      securityGroups: [vpcEndpointSecurityGroup],
      privateDnsEnabled: true,
      subnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
    });
    Tags.of(vpcSsmInterfaceEndpoint).add('Name', 'SSM interface endpoint');

    const vpcEc2MessagesInterfaceEndpoint = new ec2.InterfaceVpcEndpoint(
      this,
      'OnPremiseVpcEc2MessagesInterfaceEndpoint',
      {
        vpc: this.vpc,
        service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.ec2messages`, 443),
        securityGroups: [vpcEndpointSecurityGroup],
        privateDnsEnabled: true,
        subnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      }
    );
    Tags.of(vpcEc2MessagesInterfaceEndpoint).add('Name', 'EC2 messages interface endpoint');

    const vpcSsmMessagesInterfaceEndpoint = new ec2.InterfaceVpcEndpoint(
      this,
      'OnPremiseVpcSsmMessagesInterfaceEndpoint',
      {
        vpc: this.vpc,
        service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.ssmmessages`, 443),
        securityGroups: [vpcEndpointSecurityGroup],
        privateDnsEnabled: true,
        subnets: {
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      }
    );
    Tags.of(vpcSsmMessagesInterfaceEndpoint).add('Name', 'SSM messages interface endpoint');

    // S3 gateway endpoint in order to install software using yum
    const vpcS3GatewayEndpoint = new ec2.GatewayVpcEndpoint(this, 'OnPremiseVpcS3GatewayEndpoint', {
      vpc: this.vpc,
      service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.s3`, 443),
    });
    Tags.of(vpcS3GatewayEndpoint).add('Name', 'S3 gateway endpoint');

    // Add route table entry for communication with AWS side
    this.vpc.isolatedSubnets.forEach(({ routeTable: { routeTableId } }, index) => {
      new CfnRoute(this, 'PrivateSubnetVpnConnectionRoute' + index, {
        destinationCidrBlock: props.awsCidrRange,
        routeTableId,
        instanceId: this.routerInstance.instanceId,
      });
    });
  }
}
