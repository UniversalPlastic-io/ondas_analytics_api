import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncAssetDto {
  @ApiProperty({
    example: 'ddadf21b-0c4d-40c8-97d7-e5cf902a5024',
    description:
      'Id of the asset in the data space, as its catalog entry reports it',
  })
  sourceId!: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Re-ingest even when the content is unchanged',
  })
  force?: boolean;
}

export class SyncScanDto {
  @ApiPropertyOptional({
    example: 'innoceana',
    description:
      'Reconcile only this provider. Defaults to every provider the space offers us.',
  })
  provider?: string;

  @ApiPropertyOptional({ default: false, description: 'Report the plan without writing anything' })
  dryRun?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Re-ingest every object, changed or not' })
  force?: boolean;
}

export class SyncResultRowDto {
  @ApiProperty({ description: 'Id of the asset in the data space' })
  sourceId!: string;
  @ApiPropertyOptional({ description: 'Name the provider publishes it under' })
  label?: string;
  @ApiProperty({ enum: ['created', 'updated', 'unchanged', 'missing', 'failed', 'skipped'] }) action!: string;
  @ApiPropertyOptional() assetId?: string;
  @ApiPropertyOptional() observations?: number;
  @ApiPropertyOptional({ type: [String] }) warnings?: string[];
  @ApiPropertyOptional() error?: string;
}

export class SyncRunResponseDto {
  @ApiProperty() runId!: string;
  @ApiProperty({ enum: ['asset', 'scan'] }) kind!: string;
  @ApiProperty({ enum: ['running', 'ok', 'partial', 'failed'] }) status!: string;
  @ApiProperty() startedAt!: Date;
  @ApiProperty({ nullable: true }) finishedAt!: Date | null;
  @ApiProperty({ type: Object, description: 'assets/created/updated/unchanged/missing/failed/observations/warnings' })
  totals!: Record<string, number>;
  @ApiProperty({ type: [SyncResultRowDto] }) results!: SyncResultRowDto[];
  @ApiProperty({ type: [String] }) warnings!: string[];
}
