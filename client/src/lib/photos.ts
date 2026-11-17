/**
 * Фотографии сайта лежат в репозитории и отдаются с нашего сервера.
 * Прежние файлы на CloudFront (d2xsxph8kpxj0f.cloudfront.net) отвечают AccessDenied,
 * поэтому фоны — снимки Эльбруса, которые уже публиковались на технологист.рф.
 */
export const PHOTOS = {
  hero: "/hero/technologistika-hero-elbrus-1280.jpg",
  slope: "/hero/lower/elbrus-slope-road.jpg",
  massif: "/hero/lower/elbrus-massif.jpg",
  road: "/hero/lower/elbrus-road-bend.jpg",
} as const;
