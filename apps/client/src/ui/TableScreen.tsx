import { useState } from 'react';
import { LIMITS } from '@omni/shared';
import { navigate } from '../App';
import { playerToken, savedName, saveName } from '../lib/identity';
import { useRoom } from '../net/useRoom';
import { Game } from '../table/Game';

/** /r/CODE: ask for a name if we don't have one yet, then connect. */
export function TableScreen({ code }: { code: string }) {
  const [name, setName] = useState(savedName());
  const [draft, setDraft] = useState('');
  if (!name) {
    return (
      <div className="app">
        <div className="lobby">
          <div className="lobby-card">
            <div className="logo">
              OMNI<span>CARD</span>
            </div>
            <form
              className="panel"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                saveName(draft.trim());
                setName(draft.trim());
              }}
            >
              <div className="ptitle">JOINING TABLE {code}</div>
              <div className="prow">
                <label htmlFor="jname">YOUR NAME</label>
                <input
                  id="jname"
                  className="field"
                  autoFocus
                  maxLength={LIMITS.playerName}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.toUpperCase())}
                />
              </div>
              <button className="btn big on" type="submit">
                TAKE ME TO THE TABLE
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }
  return <Connected code={code} name={name} />;
}

function Connected({ code, name }: { code: string; name: string }) {
  const [token] = useState(playerToken);
  const { client, status, view, error } = useRoom(code, name, token);

  if (status === 'failed') {
    return (
      <div className="app">
        <div className="center-msg">
          <div className="err">{error}</div>
          <button className="btn big" onClick={() => navigate('/')}>
            BACK TO THE LOBBY
          </button>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="app">
        <div className="center-msg">
          {status === 'reconnecting' ? 'WAKING UP THE SERVER...' : 'FINDING YOUR TABLE...'}
          <div className="pnote">
            FREE SERVERS NAP WHEN NOBODY PLAYS. THE FIRST VISIT CAN TAKE UP TO A MINUTE.
          </div>
        </div>
      </div>
    );
  }
  return (
    <>
      <Game client={client} view={view} code={code} />
      {status === 'reconnecting' && <div className="banner">CONNECTION LOST. RECONNECTING...</div>}
    </>
  );
}
