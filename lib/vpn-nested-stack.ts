// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { ArnFormat, Tags } from 'aws-cdk-lib';
import { VpnResourcesProps } from './interface';

export class VpnNestedStack extends cdk.NestedStack {
  public readonly vpc: ec2.IVpc;
  public readonly routerInstance: ec2.IInstance;
  public readonly isolatedInstance: ec2.IInstance;

  constructor(scope: Construct, id: string, props: VpnResourcesProps) {
    super(scope, id, props);

    // Create customer gateway
    const customerGateway = new ec2.CfnCustomerGateway(this, 'CustomerGateway', {
      bgpAsn: 65000,
      ipAddress: props.onPremiseRouterInstance.instancePublicIp,
      type: 'ipsec.1',
    });
    Tags.of(customerGateway).add('Name', 'Customer Gateway');
    const customerGatewayId = customerGateway.ref;
    const customerGatewayArn = this.formatArn({
      service: 'ec2',
      resource: 'customer-gateway',
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      resourceName: customerGatewayId
    });

    // Virtual private gateway
    const virtualPrivateGateway = new ec2.VpnGateway(this, 'VirtualPrivateGateway', {
      type: 'ipsec.1',
    });
    const virtualPrivateGatewayArn = this.formatArn({
      service: 'ec2',
      resource: 'vpn-gateway',
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      resourceName: virtualPrivateGateway.gatewayId
    });

    // ARN to create the VPN connection
    const vpnConnectionArn = this.formatArn({
      service: 'ec2',
      resource: 'vpn-connection',
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
      resourceName: '*'
    });

    // Create VPN connection
    const vpn = new cr.AwsCustomResource(this, 'VpnConnection', {
      onCreate: {
        service: 'EC2',
        action: 'createVpnConnection',
        parameters: {
          CustomerGatewayId: customerGatewayId,
          Type: 'ipsec.1',
          Options: {
            StaticRoutesOnly: true,
          },
          VpnGatewayId: virtualPrivateGateway.gatewayId,
        },
        outputPaths: ['VpnConnection.VpnConnectionId'],
        physicalResourceId: cr.PhysicalResourceId.fromResponse('VpnConnection.VpnConnectionId'),
      },
      onDelete: {
        service: 'EC2',
        action: 'deleteVpnConnection',
        parameters: {
          VpnConnectionId: new cr.PhysicalResourceIdReference(),
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
       resources: [
         virtualPrivateGatewayArn,
         customerGatewayArn,
         vpnConnectionArn
        ]
      }),
    });
    const vpnId = vpn.getResponseField('VpnConnection.VpnConnectionId');

    // Create static route for VPN
    const vpnConnectionStaticRoute = new ec2.CfnVPNConnectionRoute(this, 'VpnConnectionStaticRoute', {
      destinationCidrBlock: props.onPremiseVpc.vpcCidrBlock,
      vpnConnectionId: vpnId,
    });

    // Attach virtual private gateway to AWS VPC
    const virtualPrivateGatewayAttachment = new ec2.CfnVPCGatewayAttachment(this, 'VirtualPrivateGatewayAttachment', {
      vpcId: props.awsVpc.vpcId,
      vpnGatewayId: virtualPrivateGateway.gatewayId,
    });

    // Enable route propagation
    props.awsVpc.publicSubnets.forEach(({ routeTable: { routeTableId } }, index) => {
      const vpnGatewayRoutePropagation = new ec2.CfnVPNGatewayRoutePropagation(this, 'VpnGatewayRoutePropagation', {
        routeTableIds: [routeTableId],
        vpnGatewayId: virtualPrivateGateway.gatewayId,
      });
      vpnGatewayRoutePropagation.node.addDependency(vpn);
    });

    props.awsVpc.isolatedSubnets.forEach(({ routeTable: { routeTableId } }, index) => {
      const vpnGatewayRoutePropagation = new ec2.CfnVPNGatewayRoutePropagation(this, 'VpnGatewayRoutePropagationIsolated', {
        routeTableIds: [routeTableId],
        vpnGatewayId: virtualPrivateGateway.gatewayId,
      });
      vpnGatewayRoutePropagation.node.addDependency(vpn);
    });
  }
}
