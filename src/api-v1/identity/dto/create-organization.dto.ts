import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty({
    example: 'innoceana',
    description: 'Stable slug, lowercase, no spaces',
  })
  slug!: string;

  @ApiProperty({ example: 'Innoceana' })
  name!: string;

  @ApiPropertyOptional({
    example: 'NGO',
    enum: ['Company', 'NGO', 'Institution', 'Campaign'],
  })
  type?: string;

  @ApiPropertyOptional({ example: 'Costa Brava, Catalunya, Spain' })
  territory?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ example: 'innoceana.org' })
  website?: string;

  @ApiPropertyOptional({ example: 'impact@innoceana.org' })
  contact?: string;

  @ApiPropertyOptional({ default: true })
  publicProfile?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['innoceana'],
    description:
      'Every spelling of this org dataProviderId found in its published datasets',
  })
  dataProviderIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['innoceana'],
    description:
      'Provider folders owned by this org. A folder is the normalised name of a participant in the space, and it is what scopes a non-admin sync',
  })
  providerFolders?: string[];
}
