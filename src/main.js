import './style.css'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

document.querySelector('#app').innerHTML = `
  <div class="app">
    <h1>🎣 Fishing Assistant</h1>
    <p class="sub">Cari arah lempar terbaik</p>
    <div id="map"></div>

    <div class="card">
      <div>📍 Posisi Saya</div>
      <strong id="location">Belum diketahui</strong>
    </div>

    <button id="gps">📍 AMBIL POSISI SAYA</button>

    <div class="card">
      <div>🌊 KONDISI LAUT</div>
      <strong id="marine">Menunggu data...</strong>
    </div>
    <div class="card target">
      <div>🎯 ARAH LEMPAR</div>
      <strong id="direction">—</strong>
      <small id="distance">Menunggu GPS...</small>
    </div>

    <div class="compass">
      <div class="arrow">➤</div>
      <div class="degree">0°</div>
    </div>
  </div>
`

let heading = 0
let smoothHeading = null
let userMarker = null
let fishingMap = null

function smoothCompass(value) {
  if (smoothHeading === null) smoothHeading = value
  const diff = ((value - smoothHeading + 540) % 360) - 180
  smoothHeading = (smoothHeading + diff * 0.15 + 360) % 360
  return smoothHeading
}

function updateCompass(value) {
  heading = Math.round(value)
  document.querySelector('.degree').textContent = `${heading}°`
  document.querySelector('.arrow').style.transform = `rotate(${heading}deg)`
}

function handleOrientation(event) {
  let h = null

  if (typeof event.webkitCompassHeading === 'number') {
    h = event.webkitCompassHeading
  } else if (typeof event.alpha === 'number') {
    h = 360 - event.alpha
  }

  if (h === null) return

  h = (h + 360) % 360
  updateCompass(smoothCompass(h))
}

async function startCompass() {
  if (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    const permission = await DeviceOrientationEvent.requestPermission()
    if (permission !== 'granted') return
  }

  window.addEventListener('deviceorientationabsolute', handleOrientation, true)
  window.addEventListener('deviceorientation', handleOrientation, true)
}

function loadMap(lat, lon) {
  if (!fishingMap) {
    fishingMap = L.map('map').setView([lat, lon], 15)

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; OpenStreetMap'
      }
    ).addTo(fishingMap)
  } else {
    fishingMap.setView([lat, lon], 15)
  }

  if (userMarker) {
    userMarker.setLatLng([lat, lon])
  } else {
    userMarker = L.marker([lat, lon])
      .addTo(fishingMap)
      .bindPopup('🎣 Posisi saya')
      .openPopup()
  }
}

document.querySelector('#gps').addEventListener('click', async () => {
  if (!navigator.geolocation) {
    alert('GPS tidak tersedia di HP ini')
    return
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude
      const lon = pos.coords.longitude

      document.querySelector('#location').textContent =
        `${lat.toFixed(6)}, ${lon.toFixed(6)}`

      document.querySelector('#distance').textContent =
        'GPS aktif • posisi ditampilkan di peta'

      loadMap(lat, lon)

      try {
        const response = await fetch('https://api.skylight.earth/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: `query GetNearestCoastline($input: GetNearestCoastlineInput!) {
              getNearestCoastline(input: $input) {
                records {
                  distanceToCoastMeters
                  nearestCoastalPoint {
                    lat
                    lon
                  }
                }
              }
            }`,
            variables: {
              input: {
                coordinates: [{ lat, lon }]
              }
            }
          })
        })

        const data = await response.json()
        const record = data?.data?.getNearestCoastline?.records?.[0]

        if (!record) throw new Error('Data coastline kosong')

        const distance = record.distanceToCoastMeters

        // Cari arah laut berdasarkan bathymetry GEBCO
        const directions = [
          ['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
          ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]
        ]
        const distances = [500, 1000, 1500]
        const R = 6371000
        const points = []

        for (const [name, deg] of directions) {
          const br = deg * Math.PI / 180
          for (const d of distances) {
            const dr = d / R
            const lat1 = lat * Math.PI / 180
            const lon1 = lon * Math.PI / 180

            const lat2 = Math.asin(
              Math.sin(lat1) * Math.cos(dr) +
              Math.cos(lat1) * Math.sin(dr) * Math.cos(br)
            )

            const lon2 = lon1 + Math.atan2(
              Math.sin(br) * Math.sin(dr) * Math.cos(lat1),
              Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2)
            )

            points.push({
              name,
              distance: d,
              lat: lat2 * 180 / Math.PI,
              lon: lon2 * 180 / Math.PI
            })
          }
        }

        const locations = points.map(p => `${p.lat},${p.lon}`).join('|')

        const marineResponse = await fetch(
          `/api/marine?latitude=${lat}&longitude=${lon}&current=sea_level_height_msl,ocean_current_velocity,ocean_current_direction,wave_height`
        )

        if (!marineResponse.ok) throw new Error('Marine API gagal')

        const marineData = await marineResponse.json()
        const marine = marineData.current

        document.querySelector('#marine').textContent =
          `🌊 Muka laut ${marine.sea_level_height_msl.toFixed(2)} m • ` +
          `🌀 Arus ${marine.ocean_current_velocity.toFixed(1)} km/j • ` +
          `🧭 ${Math.round(marine.ocean_current_direction)}° • ` +
          `〰️ Gelombang ${marine.wave_height.toFixed(2)} m`

        const depthResponse = await fetch(
          `/api/gebco?locations=${locations}`
        )
        if (!depthResponse.ok) throw new Error('GEBCO API gagal')

        const depthData = await depthResponse.json()

        const scores = directions.map(([name, deg]) => {
          const samples = points
            .map((p, i) => ({
              ...p,
              elevation: depthData.results?.[i]?.elevation ?? null
            }))
            .filter(p => p.name === name)

          const sea = samples.filter(
            p => p.elevation !== null && p.elevation < 0
          )

          const depths = sea.map(p => Math.abs(p.elevation))

          const avgDepth = depths.length
            ? depths.reduce((a, b) => a + b, 0) / depths.length
            : 0

          const maxDepth = depths.length
            ? Math.max(...depths)
            : 0

          // Utamakan arah yang konsisten masuk laut,
          // lalu kedalaman rata-rata.
          const consistency = sea.length / samples.length
          // Score kondisi spot: 0-100
          // Kedalaman ideal untuk shore casting dibuat bertahap,
          // bukan sekadar avgDepth × 10.
          const depthScore = Math.min(100, (avgDepth / 5) * 100)
          const consistencyScore = consistency * 100

          const score =
            depthScore * 0.7 +
            consistencyScore * 0.3

          return {
            name,
            deg,
            avgDepth,
            maxDepth,
            consistency,
            score
          }
        })

        const best = scores.reduce(
          (a, b) => b.score > a.score ? b : a
        )

        const depthText = best.score > 0
          ? `🌊 Kedalaman ~${best.avgDepth.toFixed(1)} m • ⭐ Kesesuaian Spot ${Math.round(best.score)}/100`
          : '⚠️ Laut belum terdeteksi'

        document.querySelector('#direction').textContent =
          best.score > 0
            ? `${best.deg}° ${best.name}`
            : '—'

        let status = ''
        if (distance <= 500) status = '🟢 Dekat laut'
        else if (distance <= 2000) status = '🟡 Dekat perairan'
        else status = '🔴 Terlalu jauh dari laut'

        document.querySelector('#distance').textContent =
          `${status} • ${depthText}`
      } catch (error) {
        console.error(error)
        document.querySelector('#distance').textContent =
          `⚠️ ${error.message || 'Data gagal dimuat'}`
      }
    },
    (err) => {
      alert(`GPS gagal: ${err.message}`)
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    }
  )

  startCompass()
})
