import { useState } from 'react';
import { LIMITS } from '@omni/shared';
import { navigate } from '../App';
import { createRoom } from '../lib/api';
import { savedName, saveName } from '../lib/identity';
import { FeedbackMenu } from './menus';
import { anchorOf, Popover, type Anchor } from './Popover';

/** Landing page: pick a name, then create a table or join one by code. */
export function Lobby() {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<Anchor | null>(null);
  const [thanks, setThanks] = useState('');

  const needName = () => {
    if (name.trim()) {
      saveName(name.trim());
      return false;
    }
    setError('PICK A NAME FIRST');
    return true;
  };

  const create = async () => {
    if (needName()) return;
    setBusy(true);
    setError('');
    try {
      const { code: c } = await createRoom();
      navigate(`/r/${c}`);
    } catch (e) {
      setError(String((e as Error).message).toUpperCase());
      setBusy(false);
    }
  };

  const join = () => {
    if (needName()) return;
    const c = code.trim().toUpperCase();
    if (c.length < 4) return setError('ENTER THE ROOM CODE YOUR FRIEND SENT');
    navigate(`/r/${c}`);
  };

  return (
    <div className="app">
      <div className="lobby">
        <div className="lobby-card">
          <div className="logo">
            OMNI<span>CARD</span>
          </div>
          <p className="tagline">A card table for almost any game. You bring the rules.</p>
          <div className="demo-cards" aria-hidden="true">
            <i className="c-AS" />
            <i className="c-b0" />
            <i className="c-QH" />
            <i className="c-b1" />
            <i className="c-JR" />
          </div>
          <div className="panel">
            <div className="prow">
              <label htmlFor="pname">YOUR NAME</label>
              <input
                id="pname"
                className="field"
                maxLength={LIMITS.playerName}
                value={name}
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value.toUpperCase())}
              />
            </div>
            <button className="btn big on" disabled={busy} onClick={create}>
              {busy ? 'SETTING UP...' : 'CREATE A TABLE'}
            </button>
            <div className="or">OR JOIN FRIENDS</div>
            <div className="join-row">
              <input
                className="field"
                placeholder="ROOM CODE"
                aria-label="Room code"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && join()}
              />
              <button className="btn big" onClick={join}>
                JOIN
              </button>
            </div>
            {error && <div className="err">{error}</div>}
            {thanks && <div className="pnote">{thanks}</div>}
          </div>
          <div className="lobby-foot">
            <button
              className="btn fb"
              data-keeps-pop
              onClick={(e) => setFeedback(feedback ? null : anchorOf(e.currentTarget))}
            >
              FEEDBACK
            </button>
          </div>
        </div>
      </div>
      {feedback && (
        <Popover anchor={feedback} onClose={() => setFeedback(null)} label="feedback">
          <FeedbackMenu
            onDone={(msg, err) => {
              if (err) setError(msg);
              else {
                setThanks(msg);
                setFeedback(null);
              }
            }}
          />
        </Popover>
      )}
    </div>
  );
}
