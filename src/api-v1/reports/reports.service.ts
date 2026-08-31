import {
  BadRequestException, Injectable, InternalServerErrorException, UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEFAULT_INCLUDE, ReportInclude, ReportRequest, ReportResponse, REPORT_TYPE_LABELS,
} from './reports.types';
import { resolvePeriod } from './reports-period';
import { validateReportRequest } from './reports-validate';
import { resolveCampaignScope } from './reports-campaign-map';
import { aggregateReportData } from './reports-data';
import { AssetsRepository, UNPLACED_OCEAN } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';
import { buildReportPdf } from './reports-pdf';
import * as reportsS3 from './reports-s3';

function randomId(): string {
  return `rep_${Math.random().toString(16).slice(2, 10)}`;
}
function bytesToMb(n: number): string {
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly assets: AssetsRepository,
    private readonly observations: ObservationsRepository,
  ) {}

  async generate(req: ReportRequest, now: Date = new Date()): Promise<ReportResponse> {
    const type = req.type;
    const detail = req.detail ?? 'standard';
    const include: Required<ReportInclude> = { ...DEFAULT_INCLUDE, ...(req.include ?? {}) };

    const period = resolvePeriod(req.period, type, now);

    const err = validateReportRequest(req, period);
    if (err) {
      const messages: Record<string, string> = {
        campaign_required: 'A campaign id is required for campaign reports.',
        date_range_required: 'period.start and period.end are required for custom reports.',
        invalid_date_range: 'period.start must not be after period.end.',
      };
      throw new BadRequestException({ error: err, message: messages[err] });
    }

    const campaign = resolveCampaignScope(req.scope?.campaign);

    let data;
    try {
      const cleanupAssets = await this.assets.findByFragments(campaign.fragments, { category: 'cleanup' });
      const rows = await this.observations.cleanupRows({
        assetIds: cleanupAssets.map((a) => a._id),
        start: period.start,
        end: period.end,
      });
      data = aggregateReportData(rows, period, campaign.campaignName, type);
    } catch (e) {
      if (e instanceof Error && e.message === 'insufficient_data') {
        throw new UnprocessableEntityException({
          error: 'insufficient_data',
          message: 'Not enough data to generate report for the selected period.',
        });
      }
      throw new InternalServerErrorException({ error: 'report_generation_failed', message: 'Failed to aggregate report data.' });
    }

    const reportId = randomId();

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await buildReportPdf({
        data, type, detail, include, campaign,
        meta: { reportId, generatedAt: now.toISOString().slice(0, 10), detail, country: 'Spain' },
      });
    } catch {
      throw new InternalServerErrorException({ error: 'report_generation_failed', message: 'Failed to render report PDF.' });
    }

    let downloadUrl: string;
    try {
      // The basin comes from the read model, which is the only thing that knows
      // where the observed assets actually are.
      const ocean =
        (await this.assets.oceanFor({ lat: campaign.lat, lon: campaign.lon })) ??
        UNPLACED_OCEAN;
      ({ downloadUrl } = await reportsS3.uploadReportToS3({ reportId, ocean, pdfBytes }));
    } catch {
      throw new InternalServerErrorException({ error: 'report_generation_failed', message: 'Failed to upload report to storage.' });
    }

    return {
      requestId: reportId,
      status: 'ready',
      name: `${REPORT_TYPE_LABELS[type]} — ${period.label}`,
      type,
      period: period.label,
      generatedAt: now.toISOString(),
      format: 'pdf',
      size: bytesToMb(pdfBytes.length),
      downloadUrl,
    };
  }
}
