/*
 * TECHNOLOGISTIKA — Home Page
 * Design: Editorial Swiss + Futuristic Alpine Industrial
 * Sections: Hero, Stats, Services, Calculator, Advantages, Technology, Brand Story, Testimonials, CTA
 */
import { useEffect, useRef, useState } from "react";
import IntroSplash, { shouldShowIntro } from "@/components/IntroSplash";
import { Link } from "wouter";
import { ArrowRight, Shield, Clock, MapPin, Truck, Globe, Building2, Network, FileText, Send, ChevronRight, Star, Phone } from "lucide-react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Calculator from "@/components/Calculator";
import { CONTACTS, STATS, SERVICES, ADVANTAGES, TESTIMONIALS } from "@/lib/constants";
import logoWatermark from "@/assets/technologistika-logo-transparent.png";

// Intersection observer hook for scroll animations
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); observer.disconnect(); } },
      { threshold }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// Animated counter
function CountUp({ target, suffix = "" }: { target: string; suffix?: string }) {
  const { ref, inView } = useInView(0.3);
  const [display, setDisplay] = useState("0");
  useEffect(() => {
    if (!inView) return;
    const num = parseInt(target.replace(/\D/g, ""));
    const duration = 1200;
    const steps = 40;
    const increment = num / steps;
    let current = 0;
    const timer = setInterval(() => {
      current = Math.min(current + increment, num);
      setDisplay(Math.floor(current).toLocaleString("ru"));
      if (current >= num) clearInterval(timer);
    }, duration / steps);
    return () => clearInterval(timer);
  }, [inView, target]);
  return <span ref={ref}>{inView ? display + (target.includes("+") ? "+" : "") + suffix : "0" + (target.includes("+") ? "+" : "") + suffix}</span>;
}

const serviceIcons: Record<string, React.ReactNode> = {
  truck: <Truck size={22} style={{ color: "#4FD1FF" }} />,
  map: <MapPin size={22} style={{ color: "#4FD1FF" }} />,
  globe: <Globe size={22} style={{ color: "#4FD1FF" }} />,
  building: <Building2 size={22} style={{ color: "#4FD1FF" }} />,
};

function LowerPlate({ name }: { name: "stats" | "services" | "tech" | "about" | "cta" }) {
  const scene = {
    stats: { file: "elbrus-slope-road", w: 640, h: 440, responsive: false },
    services: { file: "elbrus-massif", w: 1000, h: 360, responsive: true },
    tech: { file: "elbrus-slope-road", w: 640, h: 440, responsive: false },
    about: { file: "elbrus-massif", w: 1000, h: 360, responsive: true },
    cta: { file: "elbrus-road-bend", w: 1280, h: 300, responsive: true },
  }[name];
  const full = (ext: string) => `/hero/lower/${scene.file}.${ext}`;
  const small = (ext: string) => `/hero/lower/${scene.file}-640.${ext}`;
  return (
    <div className="lower-scene__plate" aria-hidden="true">
      <picture>
        <source
          type="image/avif"
          srcSet={scene.responsive ? `${small("avif")} 640w, ${full("avif")} ${scene.w}w` : full("avif")}
          sizes="100vw"
        />
        <source
          type="image/webp"
          srcSet={scene.responsive ? `${small("webp")} 640w, ${full("webp")} ${scene.w}w` : full("webp")}
          sizes="100vw"
        />
        <img
          src={full("jpg")}
          srcSet={scene.responsive ? `${small("jpg")} 640w, ${full("jpg")} ${scene.w}w` : undefined}
          sizes={scene.responsive ? "100vw" : undefined}
          alt=""
          width={scene.w}
          height={scene.h}
          decoding="async"
        />
      </picture>
    </div>
  );
}

const advantageIcons: Record<string, React.ReactNode> = {
  clock: <Clock size={20} style={{ color: "#4FD1FF" }} />,
  shield: <Shield size={20} style={{ color: "#4FD1FF" }} />,
  gps: <MapPin size={20} style={{ color: "#4FD1FF" }} />,
  fleet: <Truck size={20} style={{ color: "#4FD1FF" }} />,
  network: <Network size={20} style={{ color: "#4FD1FF" }} />,
  document: <FileText size={20} style={{ color: "#4FD1FF" }} />,
};

export default function Home() {
  const [showIntro, setShowIntro] = useState(() => shouldShowIntro());
  const heroSection = useInView(0.1);
  const statsSection = useInView(0.2);
  const servicesSection = useInView(0.1);
  const calcSection = useInView(0.1);
  const advantagesSection = useInView(0.1);
  const techSection = useInView(0.1);
  const brandSection = useInView(0.1);
  const testimonialsSection = useInView(0.1);

  // Smooth-scroll to the lead/calculator form (used by all "Рассчитать ориентировочно" CTAs)
  const scrollToCalculator = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("calculator")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div style={{ backgroundColor: "#0F1115", minHeight: "100vh" }}>
      {showIntro && <IntroSplash onComplete={() => setShowIntro(false)} />}
      <Header />

      {/* ═══════════════════════════════════════════════
          HERO SECTION
      ═══════════════════════════════════════════════ */}
      <section className="hero-scene">
        {/* Decorative local scene. The copy below carries the message. */}
        <div className="hero-scene__media">
          <picture aria-hidden="true">
            <source
              type="image/avif"
              srcSet="/hero/technologistika-hero-elbrus-780.avif 780w, /hero/technologistika-hero-elbrus-1280.avif 1280w"
              sizes="(max-width: 767px) 100vw, min(1280px, 100vw)"
            />
            <source
              type="image/webp"
              srcSet="/hero/technologistika-hero-elbrus-780.webp 780w, /hero/technologistika-hero-elbrus-1280.webp 1280w"
              sizes="(max-width: 767px) 100vw, min(1280px, 100vw)"
            />
            <img
              src="/hero/technologistika-hero-elbrus-1280.jpg"
              srcSet="/hero/technologistika-hero-elbrus-780.jpg 780w, /hero/technologistika-hero-elbrus-1280.jpg 1280w"
              sizes="(max-width: 767px) 100vw, min(1280px, 100vw)"
              alt=""
              width={1280}
              height={720}
              decoding="async"
              fetchPriority="high"
            />
          </picture>
          <div className="hero-scene__scrim" aria-hidden="true" />
          {/* On a narrow screen this media box is the lower band, so the mark sits on the scene instead of over the title. */}
          <div
            className="hero-logo-badge"
          style={{
            position: "absolute",
            top: "92px",
            right: "2rem",
            zIndex: 2,
            width: "84px",
            height: "84px",
            borderRadius: "9999px",
            backgroundColor: "rgba(248, 250, 252, 0.96)",
            border: "1px solid rgba(79, 209, 255, 0.45)",
            boxShadow: "0 0 0 1px rgba(79, 209, 255, 0.12), 0 6px 18px rgba(0, 0, 0, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          <img
            src={logoWatermark}
            alt="Логотип Technologistika"
            style={{
              width: "68%",
              height: "68%",
              objectFit: "contain",
              opacity: 1,
            }}
          />
          </div>
        </div>

        <div className="container hero-scene__copy">
          <div className="hero-scene__readability" aria-hidden="true" />
          <div
            ref={heroSection.ref}
            className="hero-scene__reveal"
            style={{
              maxWidth: "680px",
              opacity: heroSection.inView ? 1 : 0,
              transform: heroSection.inView ? "translateY(0)" : "translateY(30px)",
              transition: "all 0.7s ease-out",
            }}
          >
          <div className="hero-scene__main">
            {/* Badge */}
            <div className="section-badge" style={{ marginBottom: "1.5rem" }}>
              Перевозка автомобилей · Россия и СНГ
            </div>

            {/* Headline */}
            <h1
              style={{
                fontFamily: "'Space Grotesk', sans-serif",
                fontWeight: 800,
                fontSize: "clamp(2.5rem, 5.5vw, 4.5rem)",
                letterSpacing: "-0.03em",
                lineHeight: 1.0,
                color: "#F5F7FA",
                marginBottom: "1.5rem",
              }}
            >
              Ваш автомобиль —<br />
              <span style={{ color: "#4FD1FF" }}>под надёжным контролем.</span><br />
              По всей России.
            </h1>

            {/* Subheadline */}
            <p
              style={{
                color: "#AAB3C2",
                fontSize: "clamp(1rem, 1.5vw, 1.125rem)",
                lineHeight: 1.65,
                marginBottom: "2.5rem",
                maxWidth: "520px",
              }}
            >
              Работаем с проверенными перевозчиками и подбираем автовоз под ваш маршрут и автомобиль. Договор, фотофиксация по этапам, сопровождение до выдачи.
            </p>

            {/* CTAs */}
            <div className="hero-scene__ctas" style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "2.5rem" }}>
              <a href="#calculator" onClick={scrollToCalculator}>
                <button className="btn-primary">
                  Рассчитать ориентировочно
                  <ArrowRight size={16} />
                </button>
              </a>
              <a href={CONTACTS.telegram} target="_blank" rel="noopener noreferrer">
                <button className="btn-secondary">
                  <Send size={15} />
                  Написать в Telegram
                </button>
              </a>
            </div>
          </div>

            {/* Trust badges */}
            <div className="hero-trust" style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              {["Проверенные перевозчики", "Договор на перевозку", "Фотофиксация по этапам"].map((badge) => (
                <div key={badge} className="trust-badge">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle cx="5" cy="5" r="4" stroke="#4FD1FF" strokeWidth="1.5"/>
                    <path d="M3 5L4.5 6.5L7 3.5" stroke="#4FD1FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {badge}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          STATS BAR
      ═══════════════════════════════════════════════ */}
      <section className="lower-scene lower-scene--stats" style={{ backgroundColor: "#161A20", borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <LowerPlate name="stats" />
        <div className="container py-10">
          <div
            ref={statsSection.ref}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "2rem",
              opacity: statsSection.inView ? 1 : 0,
              transform: statsSection.inView ? "translateY(0)" : "translateY(20px)",
              transition: "all 0.6s ease-out",
            }}
            className="sm:grid-cols-4"
          >
            {STATS.map((stat, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div className="stat-number">
                  <CountUp target={stat.value} />
                </div>
                <div style={{ color: "#AAB3C2", fontSize: "0.8125rem", marginTop: "0.375rem", fontFamily: "'Inter', sans-serif" }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          SERVICES SECTION
      ═══════════════════════════════════════════════ */}
      <section className="lower-scene lower-scene--services" style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
        <LowerPlate name="services" />
        <div className="container">
          <div
            ref={servicesSection.ref}
            style={{
              opacity: servicesSection.inView ? 1 : 0,
              transform: servicesSection.inView ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.6s ease-out",
            }}
          >
            <div style={{ marginBottom: "3.5rem" }}>
              <div className="section-badge">Услуги</div>
              <h2 className="display-md" style={{ color: "#F5F7FA", marginBottom: "1rem" }}>
                Полный спектр<br />логистических решений
              </h2>
              <p style={{ color: "#AAB3C2", fontSize: "1rem", maxWidth: "480px", lineHeight: 1.6 }}>
                Для частных клиентов, автосалонов, импортёров и крупного бизнеса — мы перевозим любые автомобили по всей России.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: "1.25rem" }} className="sm:grid-cols-2 lg:grid-cols-4">
              {SERVICES.map((service, i) => (
                <Link key={service.id} href={service.href}>
                  <div
                    className="card-dark"
                    style={{
                      padding: "1.75rem",
                      height: "100%",
                      cursor: "pointer",
                      transitionDelay: `${i * 0.05}s`,
                    }}
                  >
                    <div style={{ marginBottom: "1rem" }}>
                      {serviceIcons[service.icon]}
                    </div>
                    <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "1.0625rem", color: "#F5F7FA", letterSpacing: "-0.015em", marginBottom: "0.75rem" }}>
                      {service.title}
                    </h3>
                    <p style={{ color: "#AAB3C2", fontSize: "0.875rem", lineHeight: 1.6, marginBottom: "1.25rem" }}>
                      {service.shortDesc}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", color: "#4FD1FF", fontSize: "0.8125rem", fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600 }}>
                      Подробнее <ChevronRight size={14} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          CALCULATOR SECTION
      ═══════════════════════════════════════════════ */}
      <section
        id="calculator"
        style={{
          paddingTop: "6rem",
          paddingBottom: "6rem",
          backgroundColor: "#161A20",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="container">
          <div
            ref={calcSection.ref}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "3rem",
              opacity: calcSection.inView ? 1 : 0,
              transform: calcSection.inView ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.6s ease-out",
            }}
            className="lg:grid-cols-2"
          >
            {/* Left: copy */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div className="section-badge">Расчёт стоимости</div>
              <h2 className="display-md" style={{ color: "#F5F7FA", marginBottom: "1.25rem" }}>
                Ориентировочный<br />расчёт перевозки
              </h2>
              <p style={{ color: "#AAB3C2", fontSize: "1rem", lineHeight: 1.65, marginBottom: "2rem" }}>
                Укажите маршрут и автомобиль — менеджер свяжется с вами и подтвердит окончательную стоимость после проверки маршрута, состояния авто и наличия места на автовозе. Без скрытых доплат, с договором и страхованием по его условиям.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                {[
                  "Стоимость фиксируется в договоре",
                  "Страхование — по условиям договора",
                  "Сопровождение перевозки до выдачи",
                  "Акт осмотра с фотофиксацией",
                ].map((item) => (
                  <div key={item} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: "20px", height: "20px", borderRadius: "50%", backgroundColor: "rgba(79, 209, 255, 0.1)", border: "1px solid rgba(79, 209, 255, 0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2.5 5L4 6.5L7.5 3" stroke="#4FD1FF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <span style={{ color: "#C9D4E3", fontSize: "0.9375rem" }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: form */}
            <div
              style={{
                backgroundColor: "#1C2028",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "0.5rem",
                padding: "2rem",
              }}
            >
              <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "1.25rem", color: "#F5F7FA", letterSpacing: "-0.02em", marginBottom: "1.5rem" }}>
                Заявка на расчёт
              </h3>
              <Calculator />
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          ADVANTAGES SECTION
      ═══════════════════════════════════════════════ */}
      <section style={{ paddingTop: "6rem", paddingBottom: "6rem" }}>
        <div className="container">
          <div
            ref={advantagesSection.ref}
            style={{
              opacity: advantagesSection.inView ? 1 : 0,
              transform: advantagesSection.inView ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.6s ease-out",
            }}
          >
            <div style={{ marginBottom: "3.5rem" }}>
              <div className="section-badge">Почему выбирают нас</div>
              <h2 className="display-md" style={{ color: "#F5F7FA", marginBottom: "1rem" }}>
                Надёжность на каждом<br />этапе маршрута
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: "1.5rem" }} className="sm:grid-cols-2 lg:grid-cols-3">
              {ADVANTAGES.map((adv, i) => (
                <div
                  key={i}
                  style={{
                    padding: "1.75rem",
                    backgroundColor: "#161A20",
                    border: "1px solid rgba(255,255,255,0.06)",
                    borderRadius: "0.5rem",
                    transitionDelay: `${i * 0.05}s`,
                  }}
                >
                  <div style={{ width: "40px", height: "40px", borderRadius: "0.375rem", backgroundColor: "rgba(79, 209, 255, 0.1)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
                    {advantageIcons[adv.icon]}
                  </div>
                  <h3 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "1rem", color: "#F5F7FA", letterSpacing: "-0.015em", marginBottom: "0.625rem" }}>
                    {adv.title}
                  </h3>
                  <p style={{ color: "#AAB3C2", fontSize: "0.875rem", lineHeight: 1.65 }}>
                    {adv.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          TECHNOLOGY SECTION
      ═══════════════════════════════════════════════ */}
      <section
        className="lower-scene lower-scene--tech"
        style={{
          paddingTop: "6rem",
          paddingBottom: "6rem",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#0A0D10",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <LowerPlate name="tech" />

        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div
            ref={techSection.ref}
            style={{
              opacity: techSection.inView ? 1 : 0,
              transform: techSection.inView ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.6s ease-out",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "3rem", alignItems: "center" }} className="lg:grid-cols-2">
              <div>
                <div className="section-badge">Технологии и координация</div>
                <h2 className="display-md" style={{ color: "#F5F7FA", marginBottom: "1.25rem" }}>
                  Цифровая логистика<br />нового поколения
                </h2>
                <p style={{ color: "#AAB3C2", fontSize: "1rem", lineHeight: 1.65, marginBottom: "2rem" }}>
                  Мы строим логистику, которая работает как система — с цифровой координацией, прозрачным отслеживанием и человеческой поддержкой на каждом этапе. Никаких чёрных ящиков.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {[
                    { title: "Прозрачный статус перевозки", desc: "Держим связь на всём маршруте — вы знаете, на каком этапе ваш автомобиль, без лишних звонков." },
                    { title: "Цифровое оформление документов", desc: "Договор, акт осмотра с фотофиксацией и сопроводительные документы — всё оформляется чётко и прозрачно." },
                    { title: "Персональный менеджер", desc: "Один контакт на весь маршрут. Никаких переключений между отделами." },
                    { title: "Готовность к AI-интеграции", desc: "Наша операционная модель построена с прицелом на автоматизацию и умную маршрутизацию." },
                  ].map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: "1rem" }}>
                      <div style={{ width: "2px", backgroundColor: "rgba(79, 209, 255, 0.3)", borderRadius: "1px", flexShrink: 0, alignSelf: "stretch", minHeight: "40px" }} />
                      <div>
                        <h4 style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "0.9375rem", color: "#F5F7FA", marginBottom: "0.25rem" }}>{item.title}</h4>
                        <p style={{ color: "#AAB3C2", fontSize: "0.875rem", lineHeight: 1.6 }}>{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right: tech visual */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {[
                  { label: "Покрытие маршрутов", value: "50+ городов России", pct: 85 },
                  { label: "Сопровождение", value: "до выдачи авто", pct: 95 },
                  { label: "Партнёрская сеть", value: "30+ перевозчиков", pct: 70 },
                ].map((item) => (
                  <div key={item.label} style={{ padding: "1.25rem 1.5rem", backgroundColor: "rgba(22, 26, 32, 0.8)", border: "1px solid rgba(79, 209, 255, 0.12)", borderRadius: "0.375rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                      <span style={{ color: "#AAB3C2", fontSize: "0.8125rem", fontFamily: "'Space Mono', monospace" }}>{item.label}</span>
                      <span style={{ color: "#4FD1FF", fontSize: "0.8125rem", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{item.value}</span>
                    </div>
                    <div style={{ height: "3px", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: "2px", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: techSection.inView ? `${item.pct}%` : "0%",
                          backgroundColor: "#4FD1FF",
                          borderRadius: "2px",
                          transition: "width 1.2s ease-out 0.3s",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          BRAND STORY / ELBRUS SECTION
      ═══════════════════════════════════════════════ */}
      <section
        className="lower-scene lower-scene--about"
        style={{
          paddingTop: "6rem",
          paddingBottom: "6rem",
          position: "relative",
          overflow: "hidden",
          backgroundColor: "#0F1115",
        }}
      >
        <LowerPlate name="about" />

        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <div
            ref={brandSection.ref}
            style={{
              maxWidth: "700px",
              opacity: brandSection.inView ? 1 : 0,
              transform: brandSection.inView ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.7s ease-out",
            }}
          >
            <div className="section-badge">О нас</div>
            <h2 className="display-md" style={{ color: "#F5F7FA", marginBottom: "1.5rem" }}>
              Сила, точность<br />и характер маршрута
            </h2>
            <p style={{ color: "#C9D4E3", fontSize: "1.0625rem", lineHeight: 1.7, marginBottom: "1.5rem" }}>
              Technologistika — это не просто перевозчик. Это логистическая экосистема, построенная на сочетании практического опыта, высоких стандартов сервиса и характера, который берёт начало в Кабардино-Балкарии.
            </p>
            <p style={{ color: "#AAB3C2", fontSize: "1rem", lineHeight: 1.7, marginBottom: "2rem" }}>
              Как Эльбрус — неизменный ориентир на горизонте — мы остаёмся надёжной точкой отсчёта для тех, кто доверяет нам своё самое ценное. Сила горы, точность маршрута, движение без остановок.
            </p>
            <Link href="/about">
              <button className="btn-secondary">
                О компании
                <ArrowRight size={15} />
              </button>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          TESTIMONIALS
      ═══════════════════════════════════════════════ */}
      <section
        style={{
          paddingTop: "6rem",
          paddingBottom: "6rem",
          backgroundColor: "#161A20",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div className="container">
          <div
            ref={testimonialsSection.ref}
            style={{
              opacity: testimonialsSection.inView ? 1 : 0,
              transform: testimonialsSection.inView ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.6s ease-out",
            }}
          >
            <div style={{ marginBottom: "3rem" }}>
              <div className="section-badge">Отзывы</div>
              <h2 className="display-md" style={{ color: "#F5F7FA" }}>
                Нам доверяют
              </h2>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(1, 1fr)", gap: "1.25rem" }} className="md:grid-cols-3">
              {TESTIMONIALS.map((t, i) => (
                <div
                  key={i}
                  style={{
                    padding: "1.75rem",
                    backgroundColor: "#1C2028",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", gap: "2px", marginBottom: "1rem" }}>
                    {[...Array(5)].map((_, j) => (
                      <Star key={j} size={14} style={{ color: "#F5B74F", fill: "#F5B74F" }} />
                    ))}
                  </div>
                  <p style={{ color: "#C9D4E3", fontSize: "0.9375rem", lineHeight: 1.65, marginBottom: "1.25rem", fontStyle: "italic" }}>
                    "{t.text}"
                  </p>
                  <div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: "0.9375rem", color: "#F5F7FA" }}>{t.name}</div>
                    <div style={{ color: "#AAB3C2", fontSize: "0.8125rem", marginTop: "0.125rem" }}>{t.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════
          CTA BAND
      ═══════════════════════════════════════════════ */}
      <section
        className="lower-scene lower-scene--cta"
        style={{
          paddingTop: "5rem",
          paddingBottom: "5rem",
          backgroundColor: "#0A0D10",
          borderTop: "1px solid rgba(79, 209, 255, 0.12)",
        }}
      >
        <LowerPlate name="cta" />
        <div className="container">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "1.5rem" }}>
            <h2 className="display-md" style={{ color: "#F5F7FA", maxWidth: "560px" }}>
              Готовы организовать перевозку?
            </h2>
            <p style={{ color: "#AAB3C2", fontSize: "1rem", maxWidth: "440px", lineHeight: 1.6 }}>
              Рассчитайте стоимость онлайн или позвоните — ответим в течение нескольких минут.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", justifyContent: "center" }}>
              <a href="#calculator" onClick={scrollToCalculator}>
                <button className="btn-primary">
                  Рассчитать ориентировочно
                  <ArrowRight size={16} />
                </button>
              </a>
              <a href={CONTACTS.phoneHref}>
                <button className="btn-secondary">
                  <Phone size={15} />
                  {CONTACTS.phone}
                </button>
              </a>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
