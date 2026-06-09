import React, { useState, useEffect } from 'react';
import StopList from './components/StopList';
import BusStopDetail from './components/BusStopDetail';
import TrainStationDetail from './components/TrainStationDetail';
import { Stop } from './types';

export default function App() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const cached = localStorage.getItem('cached_stops');
    const storedFavs = localStorage.getItem('stop_favorites');
    const favs = storedFavs ? JSON.parse(storedFavs) : [];

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const merged = parsed.map((s: Stop) => ({
            ...s,
            isFavorite: favs.includes(s.id)
          }));
          setStops(merged);
          setIsLoading(false);
          
          // Refresh background cache silently
          fetch('/api/stops')
            .then(res => res.json())
            .then(data => {
              if (data && data.stops) {
                const refreshedMerged = data.stops.map((s: Stop) => ({
                  ...s,
                  isFavorite: favs.includes(s.id)
                }));
                setStops(refreshedMerged);
                localStorage.setItem('cached_stops', JSON.stringify(refreshedMerged));
              }
            })
            .catch(err => console.error("Error in stops background refresh:", err));
          return;
        }
      } catch (e) {
        console.error("Error reading cached stops", e);
      }
    }

    setIsLoading(true);
    fetch('/api/stops')
      .then(res => res.json())
      .then(data => {
        if (data && data.stops) {
          const merged = data.stops.map((s: Stop) => ({
            ...s,
            isFavorite: favs.includes(s.id)
          }));
          setStops(merged);
          localStorage.setItem('cached_stops', JSON.stringify(merged));
        } else {
          setStops([]);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Error fetching stops from API:", err);
        setStops([]);
        setIsLoading(false);
      });
  }, []);

  const handleToggleFavorite = (stopId: string) => {
    const storedFavs = localStorage.getItem('stop_favorites');
    let favs = storedFavs ? JSON.parse(storedFavs) : [];
    if (favs.includes(stopId)) {
      favs = favs.filter((id: string) => id !== stopId);
    } else {
      favs.push(stopId);
    }
    localStorage.setItem('stop_favorites', JSON.stringify(favs));

    const updatedStops = stops.map(s => 
      s.id === stopId ? { ...s, isFavorite: favs.includes(s.id) } : s
    );
    setStops(updatedStops);
    localStorage.setItem('cached_stops', JSON.stringify(updatedStops));
    
    // Also update selectedStop if it's currently open
    if (selectedStop?.id === stopId) {
      setSelectedStop(prev => prev ? { ...prev, isFavorite: favs.includes(stopId) } : null);
    }
  };

  const handleClose = () => {
    setSelectedStop(null);
  };

  return (
    <div className="bg-[#03060a] h-[100dvh] w-full flex justify-center items-stretch overflow-hidden">
      <div className="bg-[#080d14] h-full w-full lg:max-w-[60%] lg:w-[60%] text-slate-100 font-sans selection:bg-teal-500/30 selection:text-teal-200 flex flex-col overflow-hidden lg:border-x lg:border-slate-800/80 lg:shadow-[0_0_50px_rgba(0,0,0,0.8)] relative">
          
          {selectedStop === null ? (
            /* Unified Center Frame - Stop List view */
            <div className="flex-1 min-h-0 w-full flex flex-col bg-[#080d14]">
              <StopList 
                stops={stops}
                isLoading={isLoading}
                onStopSelect={setSelectedStop} 
                onClose={handleClose}
                toggleFavorite={handleToggleFavorite}
                isFullScreen={true}
              />
            </div>
          ) : (
            /* Unified Center Frame - Details view (swaps on selection) */
            <div className="flex-1 min-h-0 w-full overflow-y-auto custom-scrollbar bg-[#05080c] relative">
              {selectedStop.type === 'bus' ? (
                <BusStopDetail 
                  stop={selectedStop} 
                  onBack={handleClose} 
                  toggleFavorite={handleToggleFavorite}
                />
              ) : (
                <TrainStationDetail 
                  stop={selectedStop} 
                  onBack={handleClose} 
                  toggleFavorite={handleToggleFavorite}
                />
              )}
            </div>
          )}

      </div>
    </div>
  );
}
