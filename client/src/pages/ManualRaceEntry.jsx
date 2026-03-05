import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

const emptyHorse = (index) => ({
  name: '',
  post_position: index + 1,
  jockey: '',
  trainer: '',
  morning_line_odds: ''
});

export default function ManualRaceEntry() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    track: '',
    race_number: '',
    distance: '',
    surface: 'Dirt',
    class: '',
    post_time: '',
    status: 'upcoming',
    takeout_pct: 0.22,
    horses: [emptyHorse(0), emptyHorse(1), emptyHorse(2), emptyHorse(3)]
  });

  const canSave = useMemo(() => {
    return (
      form.name.trim() &&
      form.track.trim() &&
      form.horses.filter((horse) => horse.name.trim()).length >= 2
    );
  }, [form]);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateHorse = (index, key, value) => {
    setForm((prev) => ({
      ...prev,
      horses: prev.horses.map((horse, horseIndex) =>
        horseIndex === index ? { ...horse, [key]: value } : horse
      )
    }));
  };

  const addHorse = () => {
    setForm((prev) => ({ ...prev, horses: [...prev.horses, emptyHorse(prev.horses.length)] }));
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload = {
        ...form,
        race_number: form.race_number ? Number(form.race_number) : null,
        takeout_pct: Number(form.takeout_pct),
        horses: form.horses
          .filter((horse) => horse.name.trim())
          .map((horse) => ({
            ...horse,
            post_position: horse.post_position ? Number(horse.post_position) : null
          }))
      };

      await api.createRace(payload);
      navigate('/races');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <h2 className="text-lg font-semibold">Create Manual Race</h2>
      <p className="mt-1 text-sm text-stone-600">Phase 1 captures race metadata and horse entries for local play.</p>

      <form className="mt-4 grid gap-4" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Race name"
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
          />
          <input
            className="input"
            placeholder="Track"
            value={form.track}
            onChange={(event) => updateField('track', event.target.value)}
          />
          <input
            className="input"
            placeholder="Race #"
            type="number"
            min="1"
            value={form.race_number}
            onChange={(event) => updateField('race_number', event.target.value)}
          />
          <input
            className="input"
            placeholder="Distance (e.g. 1 1/16 mi)"
            value={form.distance}
            onChange={(event) => updateField('distance', event.target.value)}
          />
          <input
            className="input"
            placeholder="Surface"
            value={form.surface}
            onChange={(event) => updateField('surface', event.target.value)}
          />
          <input
            className="input"
            placeholder="Class"
            value={form.class}
            onChange={(event) => updateField('class', event.target.value)}
          />
          <input
            className="input"
            placeholder="Post Time (ISO/local text)"
            value={form.post_time}
            onChange={(event) => updateField('post_time', event.target.value)}
          />
          <input
            className="input"
            type="number"
            min="0"
            max="1"
            step="0.01"
            placeholder="Takeout (0.22)"
            value={form.takeout_pct}
            onChange={(event) => updateField('takeout_pct', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Horses</h3>
            <button className="btn-secondary" type="button" onClick={addHorse}>
              Add Horse
            </button>
          </div>
          {form.horses.map((horse, index) => (
            <div key={index} className="grid gap-2 rounded-md border border-stone-200 p-3 sm:grid-cols-5">
              <input
                className="input sm:col-span-2"
                placeholder={`Horse ${index + 1} name`}
                value={horse.name}
                onChange={(event) => updateHorse(index, 'name', event.target.value)}
              />
              <input
                className="input"
                placeholder="Post"
                type="number"
                min="1"
                value={horse.post_position}
                onChange={(event) => updateHorse(index, 'post_position', event.target.value)}
              />
              <input
                className="input"
                placeholder="Jockey"
                value={horse.jockey}
                onChange={(event) => updateHorse(index, 'jockey', event.target.value)}
              />
              <input
                className="input"
                placeholder="Trainer"
                value={horse.trainer}
                onChange={(event) => updateHorse(index, 'trainer', event.target.value)}
              />
              <input
                className="input sm:col-span-2"
                placeholder="Morning line odds (e.g. 5/1)"
                value={horse.morning_line_odds}
                onChange={(event) => updateHorse(index, 'morning_line_odds', event.target.value)}
              />
            </div>
          ))}
        </div>

        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <button className="btn-secondary" type="button" onClick={() => navigate('/races')}>
            Cancel
          </button>
          <button className="btn-primary" type="submit" disabled={!canSave || saving}>
            {saving ? 'Saving...' : 'Create Race'}
          </button>
        </div>
      </form>
    </section>
  );
}
