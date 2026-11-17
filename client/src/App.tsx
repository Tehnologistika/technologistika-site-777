import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import CookieBanner from "./components/CookieBanner";
import Home from "./pages/Home";
import About from "./pages/About";
import Services from "./pages/Services";
import ServicesAvtovozy from "./pages/ServicesAvtovozy";
import Contacts from "./pages/Contacts";
import Privacy from "./pages/Privacy";
import Consent from "./pages/Consent";
import Cookies from "./pages/Cookies";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/about"} component={About} />
      <Route path={"/services"} component={Services} />
      <Route path={"/services/avtovozy"} component={ServicesAvtovozy} />
      <Route path={"/contacts"} component={Contacts} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/consent"} component={Consent} />
      <Route path={"/cookies"} component={Cookies} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
          <CookieBanner />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
