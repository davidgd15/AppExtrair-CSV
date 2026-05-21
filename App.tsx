import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  FlatList,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { db } from './firebaseConfig';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

// ==================== CONSTANTES ====================
const USINAS = ['GD-1', 'GD-2', 'GD-3', 'GD-4', 'PARAOPEBA-1', 'PARAOPEBA-2'];
const SUBAREAS: Record<string, string[]> = {
  'GD-1': ['UFV 1', 'UFV 2', 'UFV 3'],
  'GD-2': ['UFV 1', 'UFV 2', 'UFV 3'],
  'GD-3': ['UFV 1', 'UFV 2', 'UFV 3'],
  'GD-4': ['UFV 1', 'UFV 2', 'UFV 3'],
  'PARAOPEBA-1': ['A', 'B', 'C'],
  'PARAOPEBA-2': ['A', 'B', 'C'],
};

// Coleções de lotes (já existentes) + a nova de módulos danificados
const COLLECTIONS = [
  ...USINAS.flatMap((usina) =>
    SUBAREAS[usina].map((sub) => `${usina}-${sub.replace(/ /g, '-')}`)
  ),
  'ModulosDanificados', // <-- adicionada
];

// ==================== TIPAGENS ====================
type Module = {
  id: number;
  code: string;
  timestamp: string;
};

type Batch = {
  id?: string;
  batchId: string;
  usina: string;
  subarea: string;
  modules: Module[];
  createdAt: string;
  synced?: boolean;
  maxModules: number;
};

type DamagedModule = {
  id: string;
  code: string;
  usina: string;
  subarea: string;
  timestamp: string;
};

// ==================== FORMATADOR DE DATA ====================
const formatDateTime = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return formatter.format(date);
};

// ==================== APP SUPERVISOR ====================
export default function App() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [damagedModules, setDamagedModules] = useState<DamagedModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(COLLECTIONS[0]);
  const [exportMode, setExportMode] = useState<'simples' | 'completo'>('simples');
  const [authReady, setAuthReady] = useState(false);

  // Autenticação anônima
  useEffect(() => {
    const auth = getAuth();
    signInAnonymously(auth)
      .then(() => {
        console.log('App Extrair: autenticado.');
        setAuthReady(true);
      })
      .catch((error) => {
        console.error('Erro na autenticação:', error);
        Alert.alert('Erro', 'Falha na conexão com o servidor.');
        setLoading(false);
      });
  }, []);

  // Buscar dados da coleção selecionada
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedCollection === 'ModulosDanificados') {
        // Busca módulos danificados
        const q = query(
          collection(db, 'ModulosDanificados'),
          orderBy('timestamp', 'desc')
        );
        const snapshot = await getDocs(q);
        const loaded: DamagedModule[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          loaded.push({
            id: doc.id,
            code: data.code ?? '',
            usina: data.usina ?? '',
            subarea: data.subarea ?? '',
            timestamp: data.timestamp ?? '',
          });
        });
        setDamagedModules(loaded);
        setBatches([]); // limpa lotes
      } else {
        // Busca lotes (código original)
        const q = query(
          collection(db, selectedCollection),
          orderBy('createdAt', 'desc')
        );
        const snapshot = await getDocs(q);
        const loaded: Batch[] = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            batchId: data.batchId ?? 'Sem ID',
            usina: data.usina ?? '',
            subarea: data.subarea ?? '',
            modules: Array.isArray(data.modules) ? data.modules : [],
            createdAt: data.createdAt ?? '',
            synced: data.synced ?? true,
            maxModules: data.maxModules ?? 30,
          };
        });
        setBatches(loaded);
        setDamagedModules([]);
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha ao carregar os dados.');
      console.error(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedCollection]);

  // Carrega quando auth pronto e ao trocar coleção
  useEffect(() => {
    if (authReady) {
      fetchData();
    }
  }, [authReady, fetchData]);

  // ==================== EXPORTAÇÃO ====================
  const exportData = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      let csvContent = '';

      if (selectedCollection === 'ModulosDanificados') {
        // Exportação específica para módulos danificados
        csvContent = '\uFEFF' + 'Usina;Subarea;Código;Data/Hora\n';
        damagedModules.forEach((mod) => {
          const escapedUsina = `"${mod.usina.replace(/"/g, '""')}"`;
          const escapedSub = `"${mod.subarea.replace(/"/g, '""')}"`;
          const escapedCode = `"${mod.code.replace(/"/g, '""')}"`;
          const escapedTimestamp = `"${mod.timestamp.replace(/"/g, '""')}"`;
          csvContent += `${escapedUsina};${escapedSub};${escapedCode};${escapedTimestamp}\n`;
        });
      } else {
        // Lógica original para lotes
        if (exportMode === 'simples') {
          csvContent = '\uFEFF' + 'Lote;ID Modulo;Número de Série\n';
          batches.forEach((batch) => {
            batch.modules.forEach((mod) => {
              const escapedCode = `"${mod.code.replace(/"/g, '""')}"`;
              csvContent += `${batch.batchId};${mod.id};${escapedCode}\n`;
            });
          });
        } else {
          csvContent =
            '\uFEFF' +
            'Usina;Subarea;Lote;ID Modulo;Número de Série;Data/Hora Modulo;Data Criação Lote;Limite Módulos;Sincronizado\n';
          batches.forEach((batch) => {
            batch.modules.forEach((mod) => {
              const escapedUsina = `"${batch.usina.replace(/"/g, '""')}"`;
              const escapedSub = `"${batch.subarea.replace(/"/g, '""')}"`;
              const escapedCode = `"${mod.code.replace(/"/g, '""')}"`;
              const escapedTimestamp = `"${mod.timestamp.replace(/"/g, '""')}"`;
              const escapedCreatedAt = `"${batch.createdAt.replace(/"/g, '""')}"`;
              csvContent += `${escapedUsina};${escapedSub};${batch.batchId};${mod.id};${escapedCode};${escapedTimestamp};${escapedCreatedAt};${batch.maxModules};${batch.synced ? 'Sim' : 'Não'}\n`;
            });
          });
        }
      }

      const sanitizedCollection = selectedCollection.replace(/[/\\:*?"<>|]/g, '_');
      const fileName = `dados_${sanitizedCollection}_${formatDateTime(new Date()).replace(/[/: ]/g, '_')}.csv`;
      const filePath = FileSystem.documentDirectory + fileName;

      await FileSystem.writeAsStringAsync(filePath, csvContent, {
        encoding: 'utf8',
      });

      const isAvailable = await Sharing.isAvailableAsync();
      if (isAvailable) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'text/csv',
          dialogTitle: 'Exportar dados (CSV)',
        });
      } else {
        Alert.alert('Exportado', `Arquivo salvo em: ${filePath}`);
      }
    } catch (error) {
      Alert.alert('Erro', 'Falha ao exportar os dados.');
      console.error(error);
    } finally {
      setExporting(false);
    }
  };

  // ==================== INTERFACE ====================
  if (!authReady && loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#1976d2" />
        <Text>Conectando ao servidor...</Text>
      </View>
    );
  }

  const isDamaged = selectedCollection === 'ModulosDanificados';
  const currentData = isDamaged ? damagedModules : batches;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Modo Supervisor</Text>

      {/* Seletor de coleção */}
      <Text style={styles.label}>Tabela (coleção):</Text>
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={selectedCollection}
          onValueChange={(value) => setSelectedCollection(value)}
        >
          {COLLECTIONS.map((col) => (
            <Picker.Item key={col} label={col} value={col} />
          ))}
        </Picker>
      </View>

      {/* Seletor de modo de exportação (apenas para lotes) */}
      {!isDamaged && (
        <>
          <Text style={styles.label}>Modo de exportação:</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={exportMode}
              onValueChange={(value: 'simples' | 'completo') => setExportMode(value)}
            >
              <Picker.Item label="Simples (Lote, ID, Série)" value="simples" />
              <Picker.Item label="Completo (todas as colunas)" value="completo" />
            </Picker>
          </View>
        </>
      )}

      {/* Resumo */}
      <Text style={styles.subtitle}>
        {isDamaged
          ? `${damagedModules.length} módulo(s) danificado(s)`
          : `${batches.length} lote(s) na coleção ${selectedCollection}`}
      </Text>

      {/* Botões de ação */}
      <View style={styles.actionRow}>
        <Button
          title={refreshing ? 'Atualizando...' : 'Atualizar lista'}
          onPress={() => {
            setRefreshing(true);
            fetchData();
          }}
          disabled={refreshing}
        />
        <Button
          title={exporting ? 'Exportando...' : 'Exportar CSV'}
          onPress={exportData}
          disabled={exporting}
        />
      </View>

      {/* Lista de itens */}
      {loading && currentData.length === 0 ? (
        <ActivityIndicator size="large" color="#1976d2" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
  data={currentData as any[]}
  keyExtractor={(item: any, index: number) => item.id ?? index.toString()}
  style={styles.list}
  renderItem={({ item }) => {
    if ('batchId' in item) {
      const batch = item as Batch;
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Lote {batch.batchId} ({batch.usina} - {batch.subarea})
          </Text>
          <Text style={styles.cardSubtitle}>
            {batch.modules.length} módulo(s) • {batch.createdAt}
          </Text>
        </View>
      );
    } else {
      const mod = item as DamagedModule;
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{mod.code}</Text>
          <Text style={styles.cardSubtitle}>
            {mod.usina} - {mod.subarea} • {mod.timestamp}
          </Text>
        </View>
      );
    }
  }}
  ListEmptyComponent={
    <Text style={styles.emptyText}>Nenhum dado encontrado.</Text>
  }
/>
      )}
    </View>
  );
}

// ==================== ESTILOS ====================
const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#f5f5f5' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 20, color: '#555' },
  label: { fontSize: 16, fontWeight: 'bold', marginTop: 8, marginBottom: 4 },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  list: { flex: 1, marginTop: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    elevation: 2,
  },
  cardTitle: { fontWeight: 'bold', fontSize: 16 },
  cardSubtitle: { color: '#555', marginTop: 4 },
  emptyText: { textAlign: 'center', marginTop: 20, color: '#888' },
});