import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { Organization, OrganizationDocument } from './schemas/organization.schema';
import { User, UserDocument, UserRole } from './schemas/user.schema';

export const BCRYPT_COST = 12;

export interface CreateOrganizationInput {
  slug: string;
  name: string;
  type?: string;
  territory?: string | null;
  description?: string | null;
  website?: string | null;
  contact?: string | null;
  publicProfile?: boolean;
  dataProviderIds?: string[];
  providerFolders?: string[];
}

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  organizationSlug?: string | null;
  organizationId?: string | null;
  legacyUsername?: string | null;
}

@Injectable()
export class IdentityService {
  constructor(
    @InjectModel(Organization.name) private readonly organizations: Model<Organization>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  // -- organizations -------------------------------------------------------

  async createOrganization(input: CreateOrganizationInput): Promise<OrganizationDocument> {
    const slug = input.slug?.trim().toLowerCase();
    if (!slug) throw new BadRequestException('slug is required');
    const existing = await this.organizations.findOne({ slug }).exec();
    if (existing) throw new ConflictException(`organization "${slug}" already exists`);
    return this.organizations.create({
      slug,
      name: input.name?.trim() || slug,
      type: input.type ?? 'Company',
      territory: input.territory ?? null,
      description: input.description ?? null,
      website: input.website ?? null,
      contact: input.contact ?? null,
      publicProfile: input.publicProfile ?? true,
      dataProviderIds: input.dataProviderIds ?? [slug],
      providerFolders: input.providerFolders ?? [slug],
      active: true,
    });
  }

  async updateOrganization(slug: string, patch: Partial<CreateOrganizationInput>): Promise<OrganizationDocument> {
    const org = await this.organizations.findOneAndUpdate({ slug: slug.toLowerCase() }, { $set: patch }, { new: true }).exec();
    if (!org) throw new NotFoundException(`organization "${slug}" not found`);
    return org;
  }

  listOrganizations(): Promise<OrganizationDocument[]> {
    return this.organizations.find().sort({ slug: 1 }).exec();
  }

  findOrganizationBySlug(slug: string): Promise<OrganizationDocument | null> {
    return this.organizations.findOne({ slug: slug.toLowerCase() }).exec();
  }

  findOrganizationById(id: string): Promise<OrganizationDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.organizations.findById(id).exec();
  }

  // -- users ---------------------------------------------------------------

  async createUser(input: CreateUserInput): Promise<UserDocument> {
    const email = input.email?.trim().toLowerCase();
    if (!email || !email.includes('@')) throw new BadRequestException('a valid email is required');
    if (!input.password || input.password.length < 10) {
      throw new BadRequestException('password must be at least 10 characters');
    }
    if (await this.users.findOne({ email }).exec()) {
      throw new ConflictException(`user "${email}" already exists`);
    }

    let organizationId: Types.ObjectId | null = null;
    if (input.organizationId) {
      const org = await this.findOrganizationById(input.organizationId);
      if (!org) throw new NotFoundException(`organization ${input.organizationId} not found`);
      organizationId = org._id;
    } else if (input.organizationSlug) {
      const org = await this.findOrganizationBySlug(input.organizationSlug);
      if (!org) throw new NotFoundException(`organization "${input.organizationSlug}" not found`);
      organizationId = org._id;
    }

    if (input.role === 'provider' && !organizationId) {
      throw new BadRequestException('a provider user must belong to an organization');
    }

    return this.users.create({
      email,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_COST),
      name: input.name?.trim() || email,
      role: input.role,
      organizationId,
      legacyUsername: input.legacyUsername ?? null,
      active: true,
    });
  }

  listUsers(): Promise<UserDocument[]> {
    return this.users.find().sort({ email: 1 }).exec();
  }

  /** Looks a user up by email or by their legacy portal-connector username. */
  findByLogin(login: string): Promise<UserDocument | null> {
    const value = login.trim();
    return this.users
      .findOne({ $or: [{ email: value.toLowerCase() }, { legacyUsername: value }] })
      .select('+passwordHash')
      .exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.users.findById(id).exec();
  }

  findByLegacyUsername(username: string): Promise<UserDocument | null> {
    return this.users.findOne({ legacyUsername: username.trim() }).exec();
  }

  async verifyPassword(user: UserDocument, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async setPassword(email: string, password: string): Promise<UserDocument> {
    if (!password || password.length < 10) {
      throw new BadRequestException('password must be at least 10 characters');
    }
    const user = await this.users
      .findOneAndUpdate(
        { email: email.trim().toLowerCase() },
        { $set: { passwordHash: await bcrypt.hash(password, BCRYPT_COST) } },
        { new: true },
      )
      .exec();
    if (!user) throw new NotFoundException(`user "${email}" not found`);
    return user;
  }

  async markLogin(id: Types.ObjectId): Promise<void> {
    await this.users.updateOne({ _id: id }, { $set: { lastLoginAt: new Date() } }).exec();
  }

  countUsers(): Promise<number> {
    return this.users.countDocuments().exec();
  }
}
