# RAIDAR OBSERVABILITY NETWORK

Open source aerosystem defence engine with commercial airlines as interface example. Built with Next.js, React Three Fiber, and the OpenSky Network API.

![Raidar Observability Network](https://img.shields.io/badge/version-0.1.0-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)
![Three.js](https://img.shields.io/badge/Three.js-r170-green)

## Features

- **3D Globe Visualization** - Interactive Earth with real-time aircraft positions
- **Live Flight Data** - Real-time data from OpenSky Network API
- **Dynamic Loading** - Only loads aircraft within the current viewport
- **Level of Detail** - Switches between 3D paper planes and 2D triangles based on aircraft count
- **Flight Paths** - View historical track (solid line) and predicted path (dotted line)
- **NLP Search** - Natural language search for flights (e.g., "United flights above 35000ft")
- **Flight Info Panel** - Detailed information with boarding pass-style route display
- **Smooth Animations** - Interpolated aircraft positions and camera movements
- **Geolocation** - Starts at user's location (or NYC if denied)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- OpenSky Network account (free)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Mootbing/Raidar-Observability-Network.git
   cd Raidar-Observability-Network
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up OpenSky API credentials**
   
   Create a free account at [OpenSky Network](https://opensky-network.org/index.php?option=com_users&view=registration), then download your credentials or create a `credentials.json` file in the project root:
   
   ```json
   {
     "clientId": "your-username",
     "clientSecret": "your-password"
   }
   ```
   
   > ⚠️ This file is gitignored and should never be committed.

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Controls

| Action | Control |
|--------|---------|
| Rotate globe | Click and drag |
| Zoom | Scroll wheel |
| Orbit around point | Hold Shift + drag |
| Select aircraft | Click on plane |
| Deselect aircraft | Click [UNFOLLOW] button |
| Search flights | Use the search bar (bottom left) |

### Search Examples

The search bar supports natural language queries:

- `UAL123` - Find specific callsign
- `Delta flights` - Find all Delta aircraft
- `above 35000ft` - Find high-altitude flights
- `from Germany` - Find aircraft from Germany
- `heading north` - Find northbound flights

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── aircraft/     # OpenSky API proxy with auth & rate limiting
│   │   ├── flight-route/ # Flight route lookup
│   │   └── search/       # NLP search endpoint
│   └── page.tsx
├── components/
│   ├── Scene.tsx         # Three.js canvas setup
│   ├── Globe.tsx         # Earth sphere with texture
│   ├── AircraftLayer.tsx # Aircraft rendering manager
│   ├── AircraftDot.tsx   # Individual aircraft component
│   ├── FlightPath.tsx    # Flight path visualization
│   ├── CameraController.tsx
│   ├── Dashboard.tsx     # UI overlay
│   └── SearchBar.tsx     # NLP search interface
└── store/
    └── gameStore.ts      # Zustand state management
```

## Rate Limiting

The app includes built-in rate limiting to protect your OpenSky API quota:

| Limit | Value |
|-------|-------|
| Minimum request interval | 5 seconds |
| Max requests per minute | 10 |
| Polling interval | 15 seconds (with exponential backoff on errors) |
| Daily limit (OpenSky) | ~4,000 requests for authenticated users |

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **3D Rendering**: React Three Fiber + Three.js
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **Flight Data**: OpenSky Network API
- **NLP**: OpenAI GPT (optional, for search)

## Environment Variables (Optional)

For enhanced NLP search capabilities, add to `.env.local`:

```env
OPENAI_API_KEY=your-openai-api-key
```

## License

MIT

## Acknowledgments

- [OpenSky Network](https://opensky-network.org/) for real-time flight data
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) for 3D rendering
- [Zustand](https://github.com/pmndrs/zustand) for state management
