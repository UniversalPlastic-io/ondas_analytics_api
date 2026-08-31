import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SyncActor, SyncService } from './sync.service';
import { SyncAssetDto, SyncRunResponseDto, SyncScanDto } from './dto/sync.dto';
import { CurrentUser, Roles, RolesGuard, UserJwtAuthGuard } from '../identity/auth.guards';
import { RequestUser } from '../identity/jwt-payload';

function actorOf(user: RequestUser | null): SyncActor {
  return {
    userId: user?.userId ?? null,
    organizationId: user?.organizationId ?? null,
    role: user?.role ?? 'viewer',
  };
}

@ApiTags('Dataspace sync')
@ApiBearerAuth('portal-jwt')
@Controller('/v1/sync')
@UseGuards(UserJwtAuthGuard, RolesGuard)
@Roles('admin', 'provider')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('assets')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingest one asset that was published or updated in the data space',
    description:
      'Negotiates the contract, transfers the asset, validates its container, normalizes it and replaces its observations. Idempotent: content whose checksum is unchanged is reported as "unchanged" without writing.',
  })
  @ApiOkResponse({ type: SyncRunResponseDto })
  @ApiNotFoundResponse({ description: 'No provider offers this asset to us' })
  @ApiUnprocessableEntityResponse({ description: 'The asset is offered but is not usable' })
  async syncAsset(@Body() body: SyncAssetDto, @CurrentUser() user: RequestUser | null) {
    const sourceId = body.sourceId?.trim();
    if (!sourceId) {
      throw new BadRequestException('provide "sourceId", the asset id in the data space');
    }

    const run = await this.sync.syncAsset(sourceId, { force: !!body.force, actor: actorOf(user) });

    // A single-asset sync reports its outcome as a status code, so the caller can
    // branch without reading into the run. A scan cannot — it is a batch, and
    // reports per-asset failures inside a 200.
    const row = run.results[0];
    if (row?.action === 'missing') {
      throw new NotFoundException({
        error: 'asset_not_found',
        message: `no provider in the space offers ${sourceId} to us`,
        run,
      });
    }
    if (row?.action === 'failed') {
      throw new UnprocessableEntityException({ error: 'invalid_asset', message: row.error, run });
    }
    return run;
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reconcile the read model against what the space offers',
    description:
      'Transfers every asset under contract, writes the ones whose content changed, and flags assets no provider offers any more (their observations are kept).',
  })
  @ApiOkResponse({ type: SyncRunResponseDto })
  async scan(@Body() body: SyncScanDto, @CurrentUser() user: RequestUser | null) {
    return this.sync.scan({
      provider: body.provider,
      dryRun: !!body.dryRun,
      force: !!body.force,
      actor: actorOf(user),
    });
  }

  @Get('runs')
  @ApiOperation({ summary: 'Sync history' })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  async listRuns(@Query('limit') limit: string | undefined, @CurrentUser() user: RequestUser | null) {
    const runs = await this.sync.listRuns(actorOf(user), Number(limit) || 20);
    return runs.map((r) => ({
      runId: String(r._id),
      kind: r.kind,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      input: r.input,
      totals: r.totals,
      warnings: r.warnings,
    }));
  }

  @Get('runs/:id')
  @ApiOperation({ summary: 'One sync run, with its per-asset results' })
  async getRun(@Param('id') id: string, @CurrentUser() user: RequestUser | null) {
    const run = await this.sync.getRun(id, actorOf(user));
    return {
      runId: String(run._id),
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      input: run.input,
      totals: run.totals,
      results: run.results,
      warnings: run.warnings,
    };
  }
}
