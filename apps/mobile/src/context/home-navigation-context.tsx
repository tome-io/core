import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

interface HomeNavigationContextValue {
  searchActive: boolean;
  setSearchActive: Dispatch<SetStateAction<boolean>>;
}

const HomeNavigationContext = createContext<HomeNavigationContextValue | null>(null);

export function HomeNavigationProvider({ children }: { children: ReactNode }) {
  const [searchActive, setSearchActive] = useState(false);
  const value = useMemo(() => ({ searchActive, setSearchActive }), [searchActive]);
  return (
    <HomeNavigationContext.Provider value={value}>
      {children}
    </HomeNavigationContext.Provider>
  );
}

export function useHomeNavigation(): HomeNavigationContextValue {
  const value = useContext(HomeNavigationContext);
  if (!value) throw new Error('useHomeNavigation must be used inside HomeNavigationProvider.');
  return value;
}
