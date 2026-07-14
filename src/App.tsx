import { lazy, Suspense, useCallback, useState } from "react";
import { track } from "./lib/analytics";
import { Navbar } from "./components/Navbar";
import { Hero } from "./components/Hero";
import { OperationalAlert } from "./components/OperationalAlert";
import { IntroStatement } from "./components/sections/IntroStatement";
import { Marquee } from "./components/sections/Marquee";
import { StayFormats } from "./components/sections/StayFormats";
import { Activities } from "./components/sections/Activities";
import { Territory } from "./components/sections/Territory";
import { Amenities } from "./components/sections/Amenities";
import { BookingFlow } from "./components/sections/BookingFlow";
import { Stats } from "./components/sections/Stats";
import { Gallery } from "./components/sections/Gallery";
import { Reviews } from "./components/sections/Reviews";
import { Route } from "./components/sections/Route";
import { RulesFaq } from "./components/sections/RulesFaq";
import { FinalCta } from "./components/sections/FinalCta";
import { Footer } from "./components/Footer";
import { FloatingActions } from "./components/FloatingActions";

const BookingModal = lazy(() => import("./components/BookingModal"));
const GalleryLightbox = lazy(() => import("./components/GalleryLightbox"));

export default function App() {
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingFormat, setBookingFormat] = useState<string>();
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  const openBooking = useCallback((format?: string) => {
    setBookingFormat(format);
    setBookingOpen(true);
    track("booking_open", { format: format ?? "not_selected" });
  }, []);
  const closeBooking = useCallback(() => setBookingOpen(false), []);
  const closeGallery = useCallback(() => setGalleryIndex(null), []);

  return (
    <>
      <Navbar onBook={() => openBooking()} />
      <main>
        <Hero onBook={() => openBooking()} />
        <OperationalAlert />
        <IntroStatement />
        <Marquee />
        <StayFormats onBook={openBooking} />
        <Activities onBook={openBooking} />
        <Territory />
        <Amenities />
        <BookingFlow onBook={() => openBooking()} />
        <Stats />
        <Gallery onOpen={setGalleryIndex} />
        <Reviews />
        <Route />
        <RulesFaq />
        <FinalCta onBook={() => openBooking()} />
      </main>
      <Footer />
      <FloatingActions onBook={() => openBooking()} />
      <Suspense fallback={null}>
        <BookingModal open={bookingOpen} initialFormat={bookingFormat} onClose={closeBooking} />
        <GalleryLightbox index={galleryIndex} onChange={setGalleryIndex} onClose={closeGallery} />
      </Suspense>
    </>
  );
}
