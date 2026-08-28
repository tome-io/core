import { FormEvent, useCallback, useEffect, useState } from 'react';
import type { ExtensionRegistrySnapshot } from '@tomeio/extension-runtime';

const EMPTY_REGISTRY: ExtensionRegistrySnapshot = {
  bundled: [],
  community: [],
  thirdParty: [],
};

export function App() {
  const [registry, setRegistry] = useState<ExtensionRegistrySnapshot>(EMPTY_REGISTRY);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRegistry(await window.tomeio.extensions.list());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (event: FormEvent) => {
    event.preventDefault();
    if (!repositoryUrl.trim()) return;
    setInstalling(true);
    try {
      await window.tomeio.extensions.install(repositoryUrl);
      setRepositoryUrl('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <main className="shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <img src={new URL('../../build/icon.png', import.meta.url).href} alt="Tomeio" />
        </div>
        <nav>
          <button type="button" className="nav-item active">⌂ <span>Discover</span></button>
          <button type="button" className="nav-item">⌕ <span>Search</span></button>
          <button type="button" className="nav-item">▤ <span>Library</span></button>
          <button type="button" className="nav-item">◇ <span>Reading list</span></button>
        </nav>
        <button type="button" className="nav-item settings">⚙ <span>Settings</span></button>
      </aside>

      <section className="content">
        <header>
          <p className="eyebrow">macOS preview</p>
          <h1>Extensions</h1>
          <p className="lede">
            Official sources ship with Tomeio. Third-party sources are installed explicitly
            from a repository or manifest URL.
          </p>
        </header>

        {error ? <div className="error" role="alert">{error}</div> : null}

        <section aria-labelledby="official-title">
          <h2 id="official-title">Official</h2>
          <div className="cards">
            {registry.bundled.map((extension) => (
              <article className="card" key={extension.id}>
                <span className="badge">Bundled</span>
                <h3>{extension.name}</h3>
                <p>{extension.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="third-party-title">
          <h2 id="third-party-title">Third party</h2>
          <form className="install" onSubmit={install}>
            <label htmlFor="repository-url">Repository or manifest URL</label>
            <div className="install-row">
              <input
                id="repository-url"
                type="url"
                required
                placeholder="https://github.com/owner/repository"
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
              />
              <button type="submit" disabled={installing}>
                {installing ? 'Installing…' : 'Install'}
              </button>
            </div>
          </form>
          <div className="cards">
            {registry.thirdParty.map((extension) => (
              <article className="card" key={extension.manifest.id}>
                <span className="badge third-party">Third party</span>
                <h3>{extension.manifest.name}</h3>
                <p>{extension.manifest.description}</p>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
