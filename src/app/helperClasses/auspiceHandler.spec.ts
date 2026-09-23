import AuspiceHandler from './auspiceHandler';

describe('AuspiceHandler MicrobeTrace geography', () => {
  it('imports the same tip order that Auspice displays', () => {
    const handler = new AuspiceHandler({} as any);
    const result: any = handler.run({
      version: 'v2',
      meta: {},
      tree: {
        name: 'root',
        node_attrs: { div: 0 },
        children: [
          {
            name: 'right',
            node_attrs: { div: 0.1 },
            children: [
              { name: 'D', node_attrs: { div: 0.3 } },
              { name: 'C', node_attrs: { div: 0.2 } },
            ],
          },
          {
            name: 'left',
            node_attrs: { div: 0.1 },
            children: [
              { name: 'B', node_attrs: { div: 0.3 } },
              { name: 'A', node_attrs: { div: 0.2 } },
            ],
          },
        ],
      },
    });

    expect(result.tree.getLeaves().map(leaf => leaf.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(result.newick).toMatch(/^\(\(A:/);
  });

  it('restores coordinates from a MicrobeTrace synthetic geo resolution', () => {
    const handler = new AuspiceHandler({} as any);
    const result: any = handler.run({
      version: 'v2',
      meta: {
        updated: '2026-09-22',
        panels: ['tree', 'map'],
        geo_resolutions: [{
          key: 'microbetrace_location',
          demes: {
            sample_a: { latitude: 33.7, longitude: -84.4 },
          },
        }],
      },
      tree: {
        name: 'NODE_0000000',
        node_attrs: { div: 0 },
        children: [
          {
            name: 'A',
            node_attrs: {
              div: 0.1,
              microbetrace_location: { value: 'sample_a' },
            },
          },
          { name: 'B', node_attrs: { div: 0.2 } },
        ],
      },
    });

    const mappedNode = result.nodes.find(node => node.id === 'A');
    expect(mappedNode.latitude).toBe(33.7);
    expect(mappedNode.longitude).toBe(-84.4);
    expect(result.mapData.countries.features).toContain(jasmine.objectContaining({ id: 'sample_a' }));
  });

  it('restores coordinates from the default site resolution when multiple resolutions exist', () => {
    const handler = new AuspiceHandler({} as any);
    const result: any = handler.run({
      version: 'v2',
      meta: {
        panels: ['tree', 'map'],
        display_defaults: { geo_resolution: 'site' },
        geo_resolutions: [
          {
            key: 'country',
            demes: { usa: { latitude: 39.8, longitude: -98.6 } },
          },
          {
            key: 'state',
            demes: { georgia: { latitude: 32.7, longitude: -83.3 } },
          },
          {
            key: 'site',
            demes: { atlanta_clinic: { latitude: 33.75, longitude: -84.39 } },
          },
        ],
      },
      tree: {
        name: 'NODE_0000000',
        node_attrs: { div: 0 },
        children: [
          {
            name: 'A',
            node_attrs: {
              div: 0.1,
              country: { value: 'usa' },
              state: { value: 'georgia' },
              site: { value: 'atlanta_clinic' },
            },
          },
          { name: 'B', node_attrs: { div: 0.2 } },
        ],
      },
    });

    const mappedNode = result.nodes.find(node => node.id === 'A');
    expect(mappedNode.latitude).toBe(33.75);
    expect(mappedNode.longitude).toBe(-84.39);
    expect(result.mapData.states.features).toContain(jasmine.objectContaining({ id: 'georgia' }));
    expect(result.mapData.countries.features).toContain(jasmine.objectContaining({ id: 'atlanta_clinic' }));
  });
});
