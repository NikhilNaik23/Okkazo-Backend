const axios = require('axios');
const logger = require('../utils/logger');

const INSTAGRAM_CAPTION_LIMIT = 2200;

const PRIVATE_TEMPLATE_EVENT_TYPES = new Set([
  'birthday',
  'wedding',
  'anniversary',
  'party',
  'dinner',
]);

const PUBLIC_TEMPLATE_EVENT_TYPES = new Set([
  'concert',
  'festival',
  'exhibition',
  'workshop',
  'seminar',
]);

const normalizeEventTypeToken = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const toBoolean = (value) => {
  const token = String(value || '').trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
};

const createServiceError = (statusCode, message, details = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const sanitizeText = (value) => String(value || '')
  .replace(/\s+/g, ' ')
  .trim();

const truncateText = (value, limit) => {
  const text = sanitizeText(value);
  if (!text) return '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const formatEventDateLabel = (value) => {
  if (!value) return 'Date to be announced';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date to be announced';

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
};

const resolveSocialSynergyTemplateKey = (eventType) => {
  const normalized = normalizeEventTypeToken(eventType);
  if (PRIVATE_TEMPLATE_EVENT_TYPES.has(normalized)) return 'PRIVATE_CELEBRATION';
  if (PUBLIC_TEMPLATE_EVENT_TYPES.has(normalized)) return 'PUBLIC_SHOWCASE';
  return 'COMMON';
};

const buildSocialSynergyCaption = ({
  eventType,
  eventTitle,
  eventDescription,
  eventDate,
  eventLocation,
  eventUrl,
  templateKey,
} = {}) => {
  const resolvedTemplate = templateKey || resolveSocialSynergyTemplateKey(eventType);
  const title = truncateText(eventTitle || 'Upcoming Event', 120) || 'Upcoming Event';
  const typeLabel = truncateText(eventType || 'Special Event', 80) || 'Special Event';
  const locationLabel = truncateText(eventLocation || 'Location to be announced', 120) || 'Location to be announced';
  const dateLabel = formatEventDateLabel(eventDate);
  const description = truncateText(eventDescription || '', 700);
  const cleanUrl = sanitizeText(eventUrl || '');

  const introByTemplate = {
    PRIVATE_CELEBRATION: `Make memories that last forever at ${title}.`,
    PUBLIC_SHOWCASE: `${title} is coming soon. Step into the spotlight and be part of it.`,
    COMMON: `A special experience awaits at ${title}.`,
  };

  const hashtagsByTemplate = {
    PRIVATE_CELEBRATION: '#Okkazo #CelebrateTogether #PrivateEvents #EventPlanning',
    PUBLIC_SHOWCASE: '#Okkazo #LiveEvents #CityHappenings #BookYourSpot',
    COMMON: '#Okkazo #EventUpdate #JoinTheExperience',
  };

  const parts = [
    introByTemplate[resolvedTemplate] || introByTemplate.COMMON,
    `Type: ${typeLabel}`,
    `Date: ${dateLabel}`,
    `Location: ${locationLabel}`,
  ];

  if (description) {
    parts.push(`About: ${description}`);
  }

  if (cleanUrl) {
    parts.push(`Book now: ${cleanUrl}`);
  }

  parts.push(hashtagsByTemplate[resolvedTemplate] || hashtagsByTemplate.COMMON);

  const caption = parts.join('\n\n').trim();
  if (caption.length <= INSTAGRAM_CAPTION_LIMIT) return caption;

  return `${caption.slice(0, Math.max(0, INSTAGRAM_CAPTION_LIMIT - 1)).trimEnd()}…`;
};

const getInstagramConfig = () => ({
  baseUrl: String(process.env.INSTAGRAM_GRAPH_API_BASE_URL || 'https://graph.facebook.com/v19.0').trim().replace(/\/$/, ''),
  accessToken: String(process.env.INSTAGRAM_GRAPH_API_ACCESS_TOKEN || '').trim(),
  businessAccountId: String(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '').trim(),
  defaultImageUrl: String(process.env.INSTAGRAM_DEFAULT_IMAGE_URL || '').trim(),
  dryRun: toBoolean(process.env.INSTAGRAM_DRY_RUN),
  timeoutMs: Math.max(5000, Number(process.env.INSTAGRAM_HTTP_TIMEOUT_MS || 15000)),
});

const postSocialSynergyPromotion = async ({
  eventId,
  eventType,
  eventTitle,
  eventDescription,
  eventDate,
  eventLocation,
  eventBannerUrl,
  eventUrl,
  templateKey,
  caption,
} = {}) => {
  const normalizedEventId = sanitizeText(eventId);
  if (!normalizedEventId) {
    throw createServiceError(400, 'eventId is required for Social Synergy post');
  }

  const config = getInstagramConfig();
  const resolvedTemplate = templateKey || resolveSocialSynergyTemplateKey(eventType);
  const resolvedCaption = caption || buildSocialSynergyCaption({
    eventType,
    eventTitle,
    eventDescription,
    eventDate,
    eventLocation,
    eventUrl,
    templateKey: resolvedTemplate,
  });

  const imageUrl = sanitizeText(eventBannerUrl) || config.defaultImageUrl;
  if (!imageUrl) {
    throw createServiceError(
      422,
      'Instagram post image is required. Upload an event banner or set INSTAGRAM_DEFAULT_IMAGE_URL.'
    );
  }

  if (config.dryRun) {
    logger.info('INSTAGRAM_DRY_RUN is enabled, skipping real Instagram publish', {
      eventId: normalizedEventId,
      templateKey: resolvedTemplate,
    });

    return {
      simulated: true,
      templateKey: resolvedTemplate,
      caption: resolvedCaption,
      imageUrl,
      mediaId: null,
      permalink: null,
      publishedAt: new Date().toISOString(),
    };
  }

  if (!config.accessToken || !config.businessAccountId) {
    throw createServiceError(
      503,
      'Instagram integration is not configured. Set INSTAGRAM_GRAPH_API_ACCESS_TOKEN and INSTAGRAM_BUSINESS_ACCOUNT_ID.'
    );
  }

  try {
    const createMediaUrl = `${config.baseUrl}/${encodeURIComponent(config.businessAccountId)}/media`;
    const createMediaResponse = await axios.post(createMediaUrl, null, {
      timeout: config.timeoutMs,
      params: {
        image_url: imageUrl,
        caption: resolvedCaption,
        access_token: config.accessToken,
      },
    });

    const creationId = sanitizeText(createMediaResponse?.data?.id);
    if (!creationId) {
      throw createServiceError(502, 'Instagram media creation failed: missing creation id');
    }

    const publishMediaUrl = `${config.baseUrl}/${encodeURIComponent(config.businessAccountId)}/media_publish`;
    const publishResponse = await axios.post(publishMediaUrl, null, {
      timeout: config.timeoutMs,
      params: {
        creation_id: creationId,
        access_token: config.accessToken,
      },
    });

    const mediaId = sanitizeText(publishResponse?.data?.id);
    if (!mediaId) {
      throw createServiceError(502, 'Instagram publish failed: missing media id');
    }

    let permalink = null;
    try {
      const mediaLookupUrl = `${config.baseUrl}/${encodeURIComponent(mediaId)}`;
      const mediaLookupResponse = await axios.get(mediaLookupUrl, {
        timeout: config.timeoutMs,
        params: {
          fields: 'id,permalink',
          access_token: config.accessToken,
        },
      });

      permalink = sanitizeText(mediaLookupResponse?.data?.permalink) || null;
    } catch (lookupError) {
      logger.warn('Instagram post published but permalink lookup failed', {
        eventId: normalizedEventId,
        mediaId,
        message: lookupError?.message || String(lookupError),
      });
    }

    return {
      simulated: false,
      templateKey: resolvedTemplate,
      caption: resolvedCaption,
      imageUrl,
      mediaId,
      permalink,
      publishedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error?.statusCode) throw error;

    const providerMessage = String(
      error?.response?.data?.error?.message
      || error?.response?.data?.error
      || error?.message
      || 'Instagram publish failed'
    ).trim();

    logger.error('Failed to publish Social Synergy post to Instagram', {
      eventId: normalizedEventId,
      status: error?.response?.status,
      message: providerMessage,
    });

    throw createServiceError(502, `Failed to publish post to Instagram: ${providerMessage}`);
  }
};

module.exports = {
  resolveSocialSynergyTemplateKey,
  buildSocialSynergyCaption,
  postSocialSynergyPromotion,
};
