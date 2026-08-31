import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IdentityService } from './identity.service';
import { Roles, RolesGuard, UserJwtAuthGuard } from './auth.guards';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { CreateUserDto, SetPasswordDto } from './dto/create-user.dto';

/** Organization + user administration. Admin role only. */
@ApiTags('Admin')
@ApiBearerAuth('portal-jwt')
@Controller('v1/admin')
@UseGuards(UserJwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly identity: IdentityService) {}

  @Get('organizations')
  @ApiOperation({ summary: 'List data space participants' })
  async listOrganizations() {
    const orgs = await this.identity.listOrganizations();
    return orgs.map((o) => ({
      id: String(o._id),
      slug: o.slug,
      name: o.name,
      type: o.type,
      territory: o.territory,
      contact: o.contact,
      dataProviderIds: o.dataProviderIds,
      providerFolders: o.providerFolders,
      active: o.active,
    }));
  }

  @Post('organizations')
  @ApiOperation({ summary: 'Create a data space participant' })
  async createOrganization(@Body() body: CreateOrganizationDto) {
    const org = await this.identity.createOrganization(body);
    return { id: String(org._id), slug: org.slug, name: org.name };
  }

  @Put('organizations')
  @ApiOperation({ summary: 'Update a participant (matched by slug)' })
  async updateOrganization(@Body() body: CreateOrganizationDto) {
    const org = await this.identity.updateOrganization(body.slug, body);
    return { id: String(org._id), slug: org.slug, name: org.name };
  }

  @Get('users')
  @ApiOperation({ summary: 'List users' })
  async listUsers() {
    const users = await this.identity.listUsers();
    return users.map((u) => ({
      id: String(u._id),
      email: u.email,
      name: u.name,
      role: u.role,
      organizationId: u.organizationId ? String(u.organizationId) : null,
      legacyUsername: u.legacyUsername,
      active: u.active,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  @Post('users')
  @ApiOperation({ summary: 'Create a user attached to a participant' })
  async createUser(@Body() body: CreateUserDto) {
    const user = await this.identity.createUser({
      email: body.email,
      password: body.password,
      name: body.name,
      role: body.role,
      organizationSlug: body.organizationSlug ?? null,
      legacyUsername: body.legacyUsername ?? null,
    });
    return { id: String(user._id), email: user.email, role: user.role };
  }

  @Put('users/password')
  @ApiOperation({ summary: "Reset a user's password" })
  async setPassword(@Body() body: SetPasswordDto) {
    const user = await this.identity.setPassword(body.email, body.password);
    return { id: String(user._id), email: user.email };
  }
}
