import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class DateRangeDto {
  @ApiProperty({ example: '2025-04-10' }) start!: string;
  @ApiProperty({ example: '2025-11-10' }) end!: string;
}

class CleanupEventDto {
  @ApiProperty({ example: '2025-11-10' }) date!: string;
  @ApiProperty({ example: 22.4 }) kg!: number;
  @ApiProperty({ example: 5 }) volunteers!: number;
  @ApiProperty({ example: 1.8 }) km!: number;
  @ApiProperty({ example: '1:12:00', nullable: true }) duration!: string | null;
  @ApiProperty({ example: 3 }) evidence!: number;
}

export class MapPointDto {
  @ApiProperty({
    example: 'ddadf21b-0c4d-40c8-97d7-e5cf902a5024',
    description: 'Id of the asset in the data space',
  })
  id!: string;

  @ApiProperty({
    example: 'ddadf21b-0c4d-40c8-97d7-e5cf902a5024',
    description: 'Same value as `id`, named explicitly',
  })
  sourceId!: string;
  @ApiProperty({ example: 'Tenerife — Coastal cleanup' }) name!: string;
  @ApiProperty({ example: 'recogidas_playa' }) datasetType!: string;
  @ApiProperty({ example: 'Coastal cleanup' }) label!: string;
  @ApiProperty({ enum: ['cleanup', 'biomass', 'microplastics', 'environmental', 'atmospheric', 'oceanographic'] })
  category!: string;
  @ApiProperty({ example: '#00003F' }) color!: string;
  @ApiProperty({ example: 'innoceana' }) provider!: string;
  @ApiProperty({ example: 'atlantico' }) ocean!: string;
  @ApiProperty({ example: 28.1876 }) lat!: number;
  @ApiProperty({ example: -16.6596 }) lng!: number;
  @ApiProperty({ example: 8, nullable: true }) records!: number | null;
  @ApiPropertyOptional({ type: DateRangeDto, nullable: true }) dateRange!: DateRangeDto | null;
  @ApiProperty({ example: 'rows' }) format!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { 'Biomass depth -3_-5 m': 'Tonnes' } })
  units?: Record<string, string>;
  @ApiProperty({
    nullable: true,
    example: null,
    description:
      'Always null. An asset in the data space is reached by negotiating a contract, ' +
      'not by dereferencing a URL. Retained so existing clients do not break on a missing field.',
  })
  url!: string | null;
  @ApiProperty({ nullable: true }) metadataSchemaRef!: string | null;
  @ApiProperty({ type: [String], example: ['coords corrected 31.483,-11.926 → Tenerife (28.188,-16.660)'] })
  warnings!: string[];
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Type-specific headline stats', example: { kg: 144.87, volunteers: 31, cleanups: 8 } })
  summary?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [CleanupEventDto], description: 'cleanup datasets only' })
  cleanupsList?: CleanupEventDto[];
}

export class MapResponseDto {
  @ApiProperty({ example: 22 }) count!: number;
  @ApiProperty({ example: [[28.1876, -16.6596], [43.5721, 2.795]], description: '[[minLat,minLng],[maxLat,maxLng]] for map.fitBounds', nullable: true })
  bounds!: [[number, number], [number, number]] | null;
  @ApiProperty({ type: [MapPointDto] }) points!: MapPointDto[];
}
