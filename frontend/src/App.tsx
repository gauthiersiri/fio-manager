import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import RunsPage from './pages/RunsPage';
import RunFormPage from './pages/RunFormPage';
import RunDetailPage from './pages/RunDetailPage';
import ComparePage from './pages/ComparePage';

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
  );

export default function App() {
  const { pathname } = useLocation();
  return (
    <TooltipProvider>
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-[1584px] items-center gap-6 px-8">
          <NavLink to="/" className="text-base font-semibold">
            FIO Manager
          </NavLink>
          <nav aria-label="Main" className="flex gap-1">
            <NavLink to="/" className={() => navLink({ isActive: !pathname.startsWith('/compare') })}>
              Runs
            </NavLink>
            <NavLink to="/compare" className={navLink}>
              Compare
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1584px] px-8 py-8">
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/new" element={<RunFormPage />} />
          <Route path="/runs/:id/edit" element={<RunFormPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </TooltipProvider>
  );
}
