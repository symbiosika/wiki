---
name: PrimeVue components
description: Use when the user wants to use PrimeVue components and need details about the components.
---

# PrimeVue components

PrimeVue is a comprehensive UI component library for Vue.js 3, providing over 90 fully customizable components for building modern web applications. The library features a rich set of form controls, data visualization components, overlays, menus, and layout elements designed with accessibility, theming flexibility, and developer experience in mind. PrimeVue v4 introduces a revolutionary design token system that enables seamless theming through CSS variables and supports multiple built-in presets including Aura, Lara, Nora, and Material.

The library is organized as a monorepo containing several packages: the main `primevue` component package, `@primevue/core` for base functionality, `@primevue/themes` for theming presets, `@primevue/icons` for icon components, `@primevue/forms` for form validation, and `@primevue/nuxt-module` for Nuxt.js integration. PrimeVue supports both styled and unstyled modes, allowing developers to either use the built-in design system or apply completely custom styling with frameworks like Tailwind CSS.

## Installation and Setup

Basic installation and configuration of PrimeVue in a Vue 3 application with theme support.

```javascript
// main.js
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import App from './App.vue';

const app = createApp(App);

app.use(PrimeVue, {
    theme: {
        preset: Aura,
        options: {
            prefix: 'p',
            darkModeSelector: '.dark-mode',
            cssLayer: false
        }
    },
    ripple: true,
    locale: {
        accept: 'Yes',
        reject: 'No',
        firstDayOfWeek: 1
    },
    zIndex: {
        modal: 1100,
        overlay: 1000,
        menu: 1000,
        tooltip: 1100
    }
});

app.mount('#app');
```

## Button Component

The Button component provides various styles, sizes, severities, and loading states for user interactions.

```vue
<template>
    <div class="flex flex-wrap gap-2">
        <!-- Basic Buttons -->
        <Button label="Primary" />
        <Button label="Secondary" severity="secondary" />
        <Button label="Success" severity="success" />
        <Button label="Info" severity="info" />
        <Button label="Warning" severity="warn" />
        <Button label="Danger" severity="danger" />
        <Button label="Contrast" severity="contrast" />

        <!-- Button Variants -->
        <Button label="Outlined" variant="outlined" />
        <Button label="Text" variant="text" />
        <Button label="Link" variant="link" />

        <!-- Icon Buttons -->
        <Button icon="pi pi-check" />
        <Button label="Submit" icon="pi pi-check" />
        <Button label="Submit" icon="pi pi-check" iconPos="right" />

        <!-- Loading State -->
        <Button label="Loading" :loading="isLoading" @click="handleClick" />

        <!-- Sizes -->
        <Button label="Small" size="small" />
        <Button label="Normal" />
        <Button label="Large" size="large" />

        <!-- Rounded and Raised -->
        <Button label="Rounded" rounded />
        <Button label="Raised" raised />
        <Button icon="pi pi-bookmark" rounded raised />

        <!-- Button with Badge -->
        <Button label="Messages" badge="8" badgeSeverity="danger" />

        <!-- Button Group -->
        <ButtonGroup>
            <Button label="Save" icon="pi pi-check" />
            <Button label="Delete" icon="pi pi-trash" />
            <Button label="Cancel" icon="pi pi-times" />
        </ButtonGroup>

        <!-- Split Button -->
        <SplitButton label="Save" :model="menuItems" @click="save" />
    </div>
</template>

<script setup>
import { ref } from 'vue';
import Button from 'primevue/button';
import ButtonGroup from 'primevue/buttongroup';
import SplitButton from 'primevue/splitbutton';

const isLoading = ref(false);

const menuItems = [
    { label: 'Update', icon: 'pi pi-refresh', command: () => console.log('Update') },
    { label: 'Delete', icon: 'pi pi-times', command: () => console.log('Delete') },
    { separator: true },
    { label: 'Export', icon: 'pi pi-external-link' }
];

const handleClick = async () => {
    isLoading.value = true;
    await new Promise(resolve => setTimeout(resolve, 2000));
    isLoading.value = false;
};

const save = () => {
    console.log('Primary action clicked');
};
</script>
```

## InputText and Form Inputs

Text input components with various configurations including floating labels, icons, and validation states.

```vue
<template>
    <div class="flex flex-col gap-4">
        <!-- Basic Input -->
        <InputText v-model="username" placeholder="Username" />

        <!-- With Floating Label -->
        <FloatLabel>
            <InputText id="email" v-model="email" />
            <label for="email">Email</label>
        </FloatLabel>

        <!-- Ifta Label (In-field Top Aligned) -->
        <IftaLabel>
            <InputText id="phone" v-model="phone" />
            <label for="phone">Phone</label>
        </IftaLabel>

        <!-- With Icons -->
        <IconField>
            <InputIcon class="pi pi-search" />
            <InputText v-model="search" placeholder="Search" />
        </IconField>

        <IconField iconPosition="right">
            <InputText v-model="amount" placeholder="Amount" />
            <InputIcon class="pi pi-dollar" />
        </IconField>

        <!-- Input Group -->
        <InputGroup>
            <InputGroupAddon>
                <i class="pi pi-user"></i>
            </InputGroupAddon>
            <InputText v-model="name" placeholder="Name" />
        </InputGroup>

        <!-- Sizes -->
        <InputText v-model="small" size="small" placeholder="Small" />
        <InputText v-model="normal" placeholder="Normal" />
        <InputText v-model="large" size="large" placeholder="Large" />

        <!-- Validation States -->
        <InputText v-model="invalid" :invalid="true" placeholder="Invalid input" />
        <InputText v-model="disabled" disabled placeholder="Disabled" />

        <!-- Textarea -->
        <Textarea v-model="description" rows="5" cols="30" placeholder="Description" autoResize />

        <!-- Password with Meter -->
        <Password v-model="password" toggleMask :feedback="true" />

        <!-- InputNumber -->
        <InputNumber v-model="quantity" :min="0" :max="100" showButtons />
        <InputNumber v-model="price" mode="currency" currency="USD" locale="en-US" />
        <InputNumber v-model="percent" suffix="%" :minFractionDigits="2" />

        <!-- InputMask -->
        <InputMask v-model="phone" mask="(999) 999-9999" placeholder="(999) 999-9999" />
        <InputMask v-model="date" mask="99/99/9999" placeholder="MM/DD/YYYY" slotChar="MM/DD/YYYY" />

        <!-- InputOtp -->
        <InputOtp v-model="otp" :length="6" integerOnly />
    </div>
</template>

<script setup>
import { ref } from 'vue';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Password from 'primevue/password';
import InputNumber from 'primevue/inputnumber';
import InputMask from 'primevue/inputmask';
import InputOtp from 'primevue/inputotp';
import FloatLabel from 'primevue/floatlabel';
import IftaLabel from 'primevue/iftalabel';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';

const username = ref('');
const email = ref('');
const phone = ref('');
const search = ref('');
const amount = ref('');
const name = ref('');
const small = ref('');
const normal = ref('');
const large = ref('');
const invalid = ref('');
const disabled = ref('Disabled value');
const description = ref('');
const password = ref('');
const quantity = ref(1);
const price = ref(1500.50);
const percent = ref(25);
const date = ref('');
const otp = ref('');
</script>
```

## Select and Dropdown Components

Selection components for single and multiple value selection with filtering, grouping, and templating support.

```vue
<template>
    <div class="flex flex-col gap-4">
        <!-- Basic Select -->
        <Select v-model="selectedCity" :options="cities" optionLabel="name" placeholder="Select a City" />

        <!-- With Filter -->
        <Select v-model="selectedCountry" :options="countries" optionLabel="name"
                filter filterPlaceholder="Search" placeholder="Select a Country" />

        <!-- Editable -->
        <Select v-model="selectedBrand" :options="brands" optionLabel="name"
                editable placeholder="Select or type a brand" />

        <!-- With Clear Button -->
        <Select v-model="selectedOption" :options="options" optionLabel="label"
                showClear placeholder="Select an option" />

        <!-- Grouped Options -->
        <Select v-model="selectedCar" :options="groupedCars" optionLabel="label"
                optionGroupLabel="label" optionGroupChildren="items" placeholder="Select a Car">
            <template #optiongroup="slotProps">
                <div class="flex items-center">
                    <img :src="slotProps.option.logo" class="w-6 mr-2" />
                    <span>{{ slotProps.option.label }}</span>
                </div>
            </template>
        </Select>

        <!-- MultiSelect -->
        <MultiSelect v-model="selectedCities" :options="cities" optionLabel="name"
                     placeholder="Select Cities" :maxSelectedLabels="3" display="chip" />

        <!-- MultiSelect with Filter and SelectAll -->
        <MultiSelect v-model="selectedProducts" :options="products" optionLabel="name"
                     filter :selectAll="true" placeholder="Select Products">
            <template #option="slotProps">
                <div class="flex items-center">
                    <span class="mr-2">{{ slotProps.option.code }}</span>
                    <span>{{ slotProps.option.name }}</span>
                </div>
            </template>
        </MultiSelect>

        <!-- Listbox -->
        <Listbox v-model="selectedItem" :options="items" optionLabel="name"
                 filter filterPlaceholder="Search" class="w-full md:w-56" />

        <!-- CascadeSelect -->
        <CascadeSelect v-model="selectedLocation" :options="locations"
                       optionLabel="cname" optionGroupLabel="name"
                       :optionGroupChildren="['states', 'cities']"
                       placeholder="Select a Location" />

        <!-- TreeSelect -->
        <TreeSelect v-model="selectedNode" :options="treeNodes"
                    placeholder="Select an Item" class="w-full md:w-80" />
    </div>
</template>

<script setup>
import { ref } from 'vue';
import Select from 'primevue/select';
import MultiSelect from 'primevue/multiselect';
import Listbox from 'primevue/listbox';
import CascadeSelect from 'primevue/cascadeselect';
import TreeSelect from 'primevue/treeselect';

const cities = ref([
    { name: 'New York', code: 'NY' },
    { name: 'Rome', code: 'RM' },
    { name: 'London', code: 'LDN' },
    { name: 'Paris', code: 'PRS' }
]);

const selectedCity = ref(null);
const selectedCountry = ref(null);
const selectedBrand = ref(null);
const selectedOption = ref(null);
const selectedCar = ref(null);
const selectedCities = ref([]);
const selectedProducts = ref([]);
const selectedItem = ref(null);
const selectedLocation = ref(null);
const selectedNode = ref(null);

const countries = ref([
    { name: 'United States', code: 'US' },
    { name: 'United Kingdom', code: 'UK' },
    { name: 'Germany', code: 'DE' },
    { name: 'France', code: 'FR' }
]);

const brands = ref([
    { name: 'Audi', code: 'AU' },
    { name: 'BMW', code: 'BM' },
    { name: 'Mercedes', code: 'ME' }
]);

const options = ref([
    { label: 'Option 1', value: 1 },
    { label: 'Option 2', value: 2 }
]);

const groupedCars = ref([
    {
        label: 'German',
        logo: '/images/german.png',
        items: [
            { label: 'Audi', value: 'AU' },
            { label: 'BMW', value: 'BM' }
        ]
    },
    {
        label: 'American',
        logo: '/images/american.png',
        items: [
            { label: 'Cadillac', value: 'CA' },
            { label: 'Ford', value: 'FO' }
        ]
    }
]);

const products = ref([
    { name: 'Laptop', code: 'LP' },
    { name: 'Phone', code: 'PH' },
    { name: 'Tablet', code: 'TB' }
]);

const items = ref([
    { name: 'Item 1', code: 'I1' },
    { name: 'Item 2', code: 'I2' },
    { name: 'Item 3', code: 'I3' }
]);

const locations = ref([
    {
        name: 'United States',
        states: [
            {
                name: 'California',
                cities: [
                    { cname: 'Los Angeles' },
                    { cname: 'San Francisco' }
                ]
            }
        ]
    }
]);

const treeNodes = ref([
    {
        key: '0',
        label: 'Documents',
        children: [
            { key: '0-0', label: 'Work' },
            { key: '0-1', label: 'Home' }
        ]
    }
]);
</script>
```

## DataTable Component

Advanced data table with sorting, filtering, pagination, row selection, editing, and virtual scrolling.

```vue
<template>
    <div>
        <!-- Basic DataTable -->
        <DataTable :value="products" tableStyle="min-width: 50rem">
            <Column field="code" header="Code" sortable />
            <Column field="name" header="Name" sortable />
            <Column field="category" header="Category" sortable />
            <Column field="quantity" header="Quantity" sortable />
            <Column field="price" header="Price" sortable>
                <template #body="slotProps">
                    {{ formatCurrency(slotProps.data.price) }}
                </template>
            </Column>
        </DataTable>

        <!-- With Pagination and Filtering -->
        <DataTable :value="customers" paginator :rows="10" :rowsPerPageOptions="[5, 10, 20, 50]"
                   v-model:filters="filters" filterDisplay="row" :globalFilterFields="['name', 'country.name', 'status']"
                   dataKey="id" :loading="loading">
            <template #header>
                <div class="flex justify-end">
                    <IconField>
                        <InputIcon class="pi pi-search" />
                        <InputText v-model="filters['global'].value" placeholder="Search..." />
                    </IconField>
                </div>
            </template>
            <template #empty>No customers found.</template>
            <template #loading>Loading customers...</template>

            <Column field="name" header="Name" sortable filter filterPlaceholder="Search by name" />
            <Column field="country.name" header="Country" sortable filterField="country.name">
                <template #body="{ data }">
                    <img :src="`/flags/${data.country.code}.png`" class="mr-2 w-6" />
                    <span>{{ data.country.name }}</span>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <InputText v-model="filterModel.value" @input="filterCallback()" placeholder="Search" />
                </template>
            </Column>
            <Column field="status" header="Status" sortable :showFilterMenu="false">
                <template #body="{ data }">
                    <Tag :value="data.status" :severity="getStatusSeverity(data.status)" />
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <Select v-model="filterModel.value" :options="statuses" @change="filterCallback()"
                            placeholder="Select Status" showClear />
                </template>
            </Column>
        </DataTable>

        <!-- Row Selection -->
        <DataTable :value="products" v-model:selection="selectedProducts" selectionMode="multiple"
                   dataKey="id" :metaKeySelection="false">
            <Column selectionMode="multiple" headerStyle="width: 3rem" />
            <Column field="code" header="Code" />
            <Column field="name" header="Name" />
            <Column field="category" header="Category" />
        </DataTable>

        <!-- Row Expansion -->
        <DataTable :value="orders" v-model:expandedRows="expandedRows" dataKey="id">
            <Column expander style="width: 3rem" />
            <Column field="id" header="ID" />
            <Column field="customer" header="Customer" />
            <Column field="date" header="Date" />
            <Column field="total" header="Total" />
            <template #expansion="slotProps">
                <div class="p-4">
                    <h5>Order Items for {{ slotProps.data.customer }}</h5>
                    <DataTable :value="slotProps.data.items">
                        <Column field="product" header="Product" />
                        <Column field="quantity" header="Quantity" />
                        <Column field="price" header="Price" />
                    </DataTable>
                </div>
            </template>
        </DataTable>

        <!-- Editable Cells -->
        <DataTable :value="products" editMode="cell" @cell-edit-complete="onCellEditComplete">
            <Column field="code" header="Code" />
            <Column field="name" header="Name">
                <template #editor="{ data, field }">
                    <InputText v-model="data[field]" autofocus />
                </template>
            </Column>
            <Column field="price" header="Price">
                <template #editor="{ data, field }">
                    <InputNumber v-model="data[field]" mode="currency" currency="USD" locale="en-US" autofocus />
                </template>
            </Column>
        </DataTable>

        <!-- Virtual Scroll with Large Dataset -->
        <DataTable :value="largeDataset" scrollable scrollHeight="400px"
                   :virtualScrollerOptions="{ itemSize: 46 }">
            <Column field="id" header="ID" style="width: 20%" />
            <Column field="name" header="Name" style="width: 40%" />
            <Column field="value" header="Value" style="width: 40%" />
        </DataTable>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { FilterMatchMode } from '@primevue/core/api';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';

const products = ref([]);
const customers = ref([]);
const selectedProducts = ref([]);
const expandedRows = ref([]);
const orders = ref([]);
const loading = ref(true);
const largeDataset = ref([]);

const filters = ref({
    global: { value: null, matchMode: FilterMatchMode.CONTAINS },
    name: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
    'country.name': { value: null, matchMode: FilterMatchMode.STARTS_WITH },
    status: { value: null, matchMode: FilterMatchMode.EQUALS }
});

const statuses = ref(['unqualified', 'qualified', 'new', 'negotiation', 'renewal']);

onMounted(async () => {
    // Load data from API
    products.value = await fetchProducts();
    customers.value = await fetchCustomers();
    orders.value = await fetchOrders();
    largeDataset.value = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random() * 1000
    }));
    loading.value = false;
});

const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
};

const getStatusSeverity = (status) => {
    const severities = {
        unqualified: 'danger',
        qualified: 'success',
        new: 'info',
        negotiation: 'warn',
        renewal: 'secondary'
    };
    return severities[status];
};

const onCellEditComplete = (event) => {
    const { data, newValue, field } = event;
    if (newValue !== null && newValue !== undefined) {
        data[field] = newValue;
    }
};

// Mock fetch functions
const fetchProducts = () => Promise.resolve([
    { id: 1, code: 'P001', name: 'Product 1', category: 'Electronics', quantity: 50, price: 299.99 },
    { id: 2, code: 'P002', name: 'Product 2', category: 'Clothing', quantity: 100, price: 49.99 }
]);
const fetchCustomers = () => Promise.resolve([]);
const fetchOrders = () => Promise.resolve([]);
</script>
```

## Dialog and Overlay Components

Modal dialogs, drawers, popovers, and other overlay components for displaying content on top of the page.

```vue
<template>
    <div>
        <!-- Basic Dialog -->
        <Button label="Show Dialog" @click="dialogVisible = true" />
        <Dialog v-model:visible="dialogVisible" header="Edit Profile" :style="{ width: '450px' }" modal>
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label for="username">Username</label>
                    <InputText id="username" v-model="username" />
                </div>
                <div class="flex flex-col gap-2">
                    <label for="email">Email</label>
                    <InputText id="email" v-model="email" />
                </div>
            </div>
            <template #footer>
                <Button label="Cancel" severity="secondary" @click="dialogVisible = false" />
                <Button label="Save" @click="saveProfile" />
            </template>
        </Dialog>

        <!-- Confirm Dialog -->
        <Button label="Delete" severity="danger" @click="confirmDelete" />
        <ConfirmDialog />

        <!-- Confirm Popup -->
        <Button label="Confirm" @click="confirmPopup($event)" />
        <ConfirmPopup />

        <!-- Drawer (Sidebar) -->
        <Button label="Open Drawer" @click="drawerVisible = true" />
        <Drawer v-model:visible="drawerVisible" header="Menu" position="left">
            <Menu :model="menuItems" />
        </Drawer>

        <!-- Full Screen Drawer -->
        <Button label="Full Screen" @click="fullDrawerVisible = true" />
        <Drawer v-model:visible="fullDrawerVisible" header="Full Screen Panel" position="full">
            <p>Full screen content here...</p>
        </Drawer>

        <!-- Popover -->
        <Button type="button" label="Show Info" @click="togglePopover" />
        <Popover ref="popover">
            <div class="flex flex-col gap-4 w-80">
                <div>
                    <span class="font-medium">Title</span>
                    <p class="text-sm text-gray-500">Description of the popover content.</p>
                </div>
            </div>
        </Popover>

        <!-- Dynamic Dialog -->
        <Button label="Open Dynamic" @click="openDynamicDialog" />
        <DynamicDialog />

        <!-- Toast Messages -->
        <Toast />
        <Button label="Show Toast" @click="showToast" />
    </div>
</template>

<script setup>
import { ref } from 'vue';
import { useDialog } from 'primevue/usedialog';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import Dialog from 'primevue/dialog';
import ConfirmDialog from 'primevue/confirmdialog';
import ConfirmPopup from 'primevue/confirmpopup';
import Drawer from 'primevue/drawer';
import Popover from 'primevue/popover';
import DynamicDialog from 'primevue/dynamicdialog';
import Toast from 'primevue/toast';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import ProductDetail from './ProductDetail.vue'; // Dynamic dialog content component

const dialogVisible = ref(false);
const drawerVisible = ref(false);
const fullDrawerVisible = ref(false);
const username = ref('');
const email = ref('');
const popover = ref();

const dialog = useDialog();
const confirm = useConfirm();
const toast = useToast();

const menuItems = ref([
    { label: 'Home', icon: 'pi pi-home' },
    { label: 'About', icon: 'pi pi-info-circle' },
    { label: 'Contact', icon: 'pi pi-envelope' }
]);

const saveProfile = () => {
    dialogVisible.value = false;
    toast.add({ severity: 'success', summary: 'Success', detail: 'Profile saved', life: 3000 });
};

const confirmDelete = () => {
    confirm.require({
        message: 'Are you sure you want to delete this record?',
        header: 'Delete Confirmation',
        icon: 'pi pi-exclamation-triangle',
        rejectProps: { label: 'Cancel', severity: 'secondary' },
        acceptProps: { label: 'Delete', severity: 'danger' },
        accept: () => {
            toast.add({ severity: 'info', summary: 'Deleted', detail: 'Record deleted', life: 3000 });
        },
        reject: () => {
            toast.add({ severity: 'warn', summary: 'Cancelled', detail: 'Delete cancelled', life: 3000 });
        }
    });
};

const confirmPopup = (event) => {
    confirm.require({
        target: event.currentTarget,
        message: 'Do you want to proceed?',
        icon: 'pi pi-question-circle',
        accept: () => toast.add({ severity: 'success', summary: 'Confirmed', life: 3000 }),
        reject: () => toast.add({ severity: 'error', summary: 'Rejected', life: 3000 })
    });
};

const togglePopover = (event) => {
    popover.value.toggle(event);
};

const openDynamicDialog = () => {
    dialog.open(ProductDetail, {
        props: {
            header: 'Product Details',
            style: { width: '50vw' },
            modal: true
        },
        data: {
            productId: 123
        },
        onClose: (options) => {
            if (options.data) {
                toast.add({ severity: 'info', summary: 'Closed', detail: options.data.message, life: 3000 });
            }
        }
    });
};

const showToast = () => {
    toast.add({ severity: 'success', summary: 'Success', detail: 'Operation completed', life: 3000 });
    toast.add({ severity: 'info', summary: 'Info', detail: 'Information message', life: 3000 });
    toast.add({ severity: 'warn', summary: 'Warning', detail: 'Warning message', life: 3000 });
    toast.add({ severity: 'error', summary: 'Error', detail: 'Error message', life: 3000 });
};
</script>
```

## Form Validation with @primevue/forms

Comprehensive form handling with validation using the Forms package, supporting various resolver libraries like Yup, Zod, and Valibot.

```vue
<template>
    <Form v-slot="$form" :initialValues :resolver @submit="onSubmit">
        <div class="flex flex-col gap-4">
            <!-- Text Input with Validation -->
            <div class="flex flex-col gap-2">
                <label for="username">Username</label>
                <InputText id="username" name="username" type="text" />
                <Message v-if="$form.username?.invalid" severity="error" size="small">
                    {{ $form.username.error?.message }}
                </Message>
            </div>

            <!-- Email with Validation -->
            <div class="flex flex-col gap-2">
                <label for="email">Email</label>
                <InputText id="email" name="email" type="email" />
                <Message v-if="$form.email?.invalid" severity="error" size="small">
                    {{ $form.email.error?.message }}
                </Message>
            </div>

            <!-- Password -->
            <div class="flex flex-col gap-2">
                <label for="password">Password</label>
                <Password id="password" name="password" toggleMask :feedback="false" />
                <Message v-if="$form.password?.invalid" severity="error" size="small">
                    {{ $form.password.error?.message }}
                </Message>
            </div>

            <!-- Select with Validation -->
            <div class="flex flex-col gap-2">
                <label for="country">Country</label>
                <Select id="country" name="country" :options="countries" optionLabel="name"
                        placeholder="Select a Country" />
                <Message v-if="$form.country?.invalid" severity="error" size="small">
                    {{ $form.country.error?.message }}
                </Message>
            </div>

            <!-- Checkbox -->
            <div class="flex items-center gap-2">
                <Checkbox inputId="terms" name="terms" binary />
                <label for="terms">I agree to the terms and conditions</label>
            </div>
            <Message v-if="$form.terms?.invalid" severity="error" size="small">
                {{ $form.terms.error?.message }}
            </Message>

            <!-- Submit Button -->
            <Button type="submit" label="Submit" :disabled="!$form.valid" />

            <!-- Form State Debug -->
            <pre class="text-sm">Valid: {{ $form.valid }}</pre>
        </div>
    </Form>
</template>

<script setup>
import { ref } from 'vue';
import { Form } from '@primevue/forms';
import { zodResolver } from '@primevue/forms/resolvers';
import { z } from 'zod';
import InputText from 'primevue/inputtext';
import Password from 'primevue/password';
import Select from 'primevue/select';
import Checkbox from 'primevue/checkbox';
import Button from 'primevue/button';
import Message from 'primevue/message';

// Form Schema with Zod
const schema = z.object({
    username: z.string().min(3, 'Username must be at least 3 characters').max(20),
    email: z.string().email('Please enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    country: z.object({ name: z.string(), code: z.string() }).nullable().refine(val => val !== null, 'Please select a country'),
    terms: z.boolean().refine(val => val === true, 'You must accept the terms')
});

const resolver = zodResolver(schema);

const initialValues = {
    username: '',
    email: '',
    password: '',
    country: null,
    terms: false
};

const countries = ref([
    { name: 'United States', code: 'US' },
    { name: 'United Kingdom', code: 'UK' },
    { name: 'Germany', code: 'DE' },
    { name: 'France', code: 'FR' }
]);

const onSubmit = ({ valid, values, errors }) => {
    if (valid) {
        console.log('Form submitted:', values);
    } else {
        console.log('Form has errors:', errors);
    }
};
</script>
```

## useForm Composable

Direct use of the useForm composable for more control over form state management.

```vue
<template>
    <form @submit="onFormSubmit">
        <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
                <label for="name">Name</label>
                <InputText id="name" v-model="nameField.value" v-bind="nameProps" />
                <small v-if="nameField.invalid" class="text-red-500">{{ nameField.error }}</small>
            </div>

            <div class="flex flex-col gap-2">
                <label for="amount">Amount</label>
                <InputNumber id="amount" v-model="amountField.value" v-bind="amountProps"
                             mode="currency" currency="USD" />
                <small v-if="amountField.invalid" class="text-red-500">{{ amountField.error }}</small>
            </div>

            <div class="flex gap-2">
                <Button type="submit" label="Submit" />
                <Button type="button" label="Reset" severity="secondary" @click="reset" />
                <Button type="button" label="Validate" severity="info" @click="validateForm" />
            </div>

            <div class="text-sm">
                <p>Form Valid: {{ valid }}</p>
                <p>Name touched: {{ nameField.touched }}</p>
                <p>Name dirty: {{ nameField.dirty }}</p>
            </div>
        </div>
    </form>
</template>

<script setup>
import { useForm } from '@primevue/forms/useform';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Button from 'primevue/button';

const {
    defineField,
    handleSubmit,
    validate,
    reset,
    valid,
    setFieldValue,
    setValues
} = useForm({
    initialValues: {
        name: '',
        amount: 0
    },
    resolver: ({ values }) => {
        const errors = {};

        if (!values.name || values.name.length < 2) {
            errors.name = [{ message: 'Name must be at least 2 characters' }];
        }

        if (values.amount <= 0) {
            errors.amount = [{ message: 'Amount must be greater than 0' }];
        }

        return { errors, values };
    }
});

const [nameField, nameProps] = defineField('name', {
    validateOnBlur: true,
    validateOnValueUpdate: true
});

const [amountField, amountProps] = defineField('amount', {
    validateOnBlur: true
});

const onFormSubmit = handleSubmit(({ valid, values, errors }) => {
    if (valid) {
        console.log('Submitted:', values);
    } else {
        console.log('Validation errors:', errors);
    }
});

const validateForm = async () => {
    const result = await validate();
    console.log('Validation result:', result);
};

// Programmatically set values
const prefillForm = () => {
    setValues({
        name: 'John Doe',
        amount: 100
    });
};
</script>
```

## Theming and Design Tokens

Customizing themes using design tokens and the definePreset function.

```javascript
// theme-config.js
import { definePreset } from '@primeuix/styled';
import Aura from '@primevue/themes/aura';

// Create a custom preset based on Aura
const MyPreset = definePreset(Aura, {
    // Customize semantic colors
    semantic: {
        primary: {
            50: '{indigo.50}',
            100: '{indigo.100}',
            200: '{indigo.200}',
            300: '{indigo.300}',
            400: '{indigo.400}',
            500: '{indigo.500}',
            600: '{indigo.600}',
            700: '{indigo.700}',
            800: '{indigo.800}',
            900: '{indigo.900}',
            950: '{indigo.950}'
        },
        colorScheme: {
            light: {
                primary: {
                    color: '{indigo.500}',
                    inverseColor: '#ffffff',
                    hoverColor: '{indigo.600}',
                    activeColor: '{indigo.700}'
                },
                surface: {
                    0: '#ffffff',
                    50: '{slate.50}',
                    100: '{slate.100}',
                    200: '{slate.200}',
                    300: '{slate.300}',
                    400: '{slate.400}',
                    500: '{slate.500}',
                    600: '{slate.600}',
                    700: '{slate.700}',
                    800: '{slate.800}',
                    900: '{slate.900}',
                    950: '{slate.950}'
                }
            },
            dark: {
                primary: {
                    color: '{indigo.400}',
                    inverseColor: '{slate.900}',
                    hoverColor: '{indigo.300}',
                    activeColor: '{indigo.200}'
                },
                surface: {
                    0: '#1a1a2e',
                    50: '{zinc.800}',
                    100: '{zinc.700}',
                    200: '{zinc.600}',
                    300: '{zinc.500}',
                    400: '{zinc.400}',
                    500: '{zinc.300}',
                    600: '{zinc.200}',
                    700: '{zinc.100}',
                    800: '{zinc.50}',
                    900: '{zinc.50}',
                    950: '{zinc.50}'
                }
            }
        }
    },
    // Customize component-specific tokens
    components: {
        button: {
            borderRadius: '{border.radius.lg}',
            paddingX: '1.25rem',
            paddingY: '0.75rem'
        },
        card: {
            borderRadius: '{border.radius.xl}',
            shadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
        },
        inputtext: {
            borderRadius: '{border.radius.md}',
            focusRing: {
                width: '2px',
                color: '{primary.color}'
            }
        }
    }
});

export default MyPreset;
```

```javascript
// main.js - Using the custom preset
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import MyPreset from './theme-config';
import App from './App.vue';

const app = createApp(App);

app.use(PrimeVue, {
    theme: {
        preset: MyPreset,
        options: {
            prefix: 'p',
            darkModeSelector: '.dark',
            cssLayer: {
                name: 'primevue',
                order: 'tailwind-base, primevue, tailwind-utilities'
            }
        }
    }
});

app.mount('#app');
```

```vue
<!-- Using dt prop for component-level customization -->
<template>
    <Button
        label="Custom Button"
        :dt="{
            root: {
                borderRadius: '9999px',
                background: 'linear-gradient(to right, #667eea 0%, #764ba2 100%)'
            }
        }"
    />

    <Card
        :dt="{
            root: {
                background: '{surface.100}',
                borderRadius: '1rem'
            },
            title: {
                fontSize: '1.5rem',
                fontWeight: '700'
            }
        }">
        <template #title>Custom Styled Card</template>
        <template #content>Card content with custom styling.</template>
    </Card>
</template>
```

## Nuxt.js Integration

Setting up PrimeVue with Nuxt 3 using the official module.

```javascript
// nuxt.config.ts
export default defineNuxtConfig({
    modules: ['@primevue/nuxt-module'],
    primevue: {
        autoImport: true,
        options: {
            ripple: true,
            inputVariant: 'filled',
            theme: {
                preset: 'Aura',
                options: {
                    prefix: 'p',
                    darkModeSelector: '.dark-mode',
                    cssLayer: false
                }
            }
        },
        components: {
            prefix: 'Prime',
            include: ['Button', 'InputText', 'DataTable', 'Column', 'Dialog'],
            exclude: ['Editor', 'Chart']
        },
        directives: {
            include: ['Tooltip', 'Ripple', 'StyleClass']
        },
        composables: {
            include: ['useToast', 'useConfirm', 'useDialog']
        }
    },
    css: ['primeicons/primeicons.css']
});
```

```vue
<!-- pages/index.vue - Components are auto-imported -->
<template>
    <div>
        <PrimeButton label="Click Me" @click="showToast" />
        <PrimeToast />

        <PrimeDataTable :value="products" paginator :rows="5">
            <PrimeColumn field="name" header="Name" />
            <PrimeColumn field="price" header="Price" />
        </PrimeDataTable>
    </div>
</template>

<script setup>
const toast = useToast();
const products = ref([
    { name: 'Product 1', price: 100 },
    { name: 'Product 2', price: 200 }
]);

const showToast = () => {
    toast.add({ severity: 'success', summary: 'Success', detail: 'Message sent', life: 3000 });
};
</script>
```

## Menu and Navigation Components

Various menu components for application navigation.

```vue
<template>
    <div>
        <!-- Menubar (Horizontal Navigation) -->
        <Menubar :model="menuItems">
            <template #start>
                <img src="/logo.png" alt="Logo" class="h-8" />
            </template>
            <template #end>
                <Button icon="pi pi-user" rounded text />
            </template>
        </Menubar>

        <!-- Breadcrumb -->
        <Breadcrumb :home="home" :model="breadcrumbItems" />

        <!-- TabMenu -->
        <TabMenu :model="tabItems" />

        <!-- Steps -->
        <Steps :model="stepItems" :activeStep="activeStep" />

        <!-- TieredMenu -->
        <Button label="Menu" @click="toggleMenu" />
        <TieredMenu ref="tieredMenu" :model="tieredItems" popup />

        <!-- ContextMenu -->
        <div @contextmenu="onRightClick" class="p-4 bg-surface-100 rounded">
            Right-click here
        </div>
        <ContextMenu ref="contextMenu" :model="contextItems" />

        <!-- PanelMenu (Accordion Menu) -->
        <PanelMenu :model="panelItems" />

        <!-- MegaMenu -->
        <MegaMenu :model="megaItems" orientation="horizontal" />

        <!-- Dock -->
        <Dock :model="dockItems" position="bottom" />
    </div>
</template>

<script setup>
import { ref } from 'vue';
import Menubar from 'primevue/menubar';
import Breadcrumb from 'primevue/breadcrumb';
import TabMenu from 'primevue/tabmenu';
import Steps from 'primevue/steps';
import TieredMenu from 'primevue/tieredmenu';
import ContextMenu from 'primevue/contextmenu';
import PanelMenu from 'primevue/panelmenu';
import MegaMenu from 'primevue/megamenu';
import Dock from 'primevue/dock';
import Button from 'primevue/button';

const tieredMenu = ref();
const contextMenu = ref();
const activeStep = ref(0);

const menuItems = ref([
    { label: 'Home', icon: 'pi pi-home', command: () => router.push('/') },
    {
        label: 'Products',
        icon: 'pi pi-box',
        items: [
            { label: 'Electronics', icon: 'pi pi-desktop' },
            { label: 'Clothing', icon: 'pi pi-tag' },
            { separator: true },
            { label: 'All Products', icon: 'pi pi-list' }
        ]
    },
    { label: 'Contact', icon: 'pi pi-envelope' }
]);

const home = ref({ icon: 'pi pi-home', to: '/' });
const breadcrumbItems = ref([
    { label: 'Products', to: '/products' },
    { label: 'Electronics', to: '/products/electronics' },
    { label: 'Laptops' }
]);

const tabItems = ref([
    { label: 'Dashboard', icon: 'pi pi-home' },
    { label: 'Reports', icon: 'pi pi-chart-bar' },
    { label: 'Settings', icon: 'pi pi-cog' }
]);

const stepItems = ref([
    { label: 'Personal' },
    { label: 'Address' },
    { label: 'Payment' },
    { label: 'Confirmation' }
]);

const tieredItems = ref([
    {
        label: 'File',
        icon: 'pi pi-file',
        items: [
            { label: 'New', icon: 'pi pi-plus' },
            { label: 'Open', icon: 'pi pi-folder-open' },
            { separator: true },
            { label: 'Exit', icon: 'pi pi-times' }
        ]
    },
    { label: 'Edit', icon: 'pi pi-pencil' },
    { label: 'Help', icon: 'pi pi-question-circle' }
]);

const contextItems = ref([
    { label: 'Copy', icon: 'pi pi-copy' },
    { label: 'Paste', icon: 'pi pi-clipboard' },
    { separator: true },
    { label: 'Delete', icon: 'pi pi-trash' }
]);

const panelItems = ref([
    {
        label: 'Files',
        icon: 'pi pi-folder',
        items: [
            { label: 'Documents', icon: 'pi pi-file' },
            { label: 'Images', icon: 'pi pi-image' }
        ]
    },
    {
        label: 'Settings',
        icon: 'pi pi-cog',
        items: [
            { label: 'Profile', icon: 'pi pi-user' },
            { label: 'Preferences', icon: 'pi pi-sliders-h' }
        ]
    }
]);

const megaItems = ref([
    {
        label: 'Products',
        icon: 'pi pi-box',
        items: [
            [
                { label: 'Electronics', items: [{ label: 'Computers' }, { label: 'Phones' }] }
            ],
            [
                { label: 'Home', items: [{ label: 'Furniture' }, { label: 'Decor' }] }
            ]
        ]
    }
]);

const dockItems = ref([
    { label: 'Finder', icon: '/icons/finder.svg' },
    { label: 'Safari', icon: '/icons/safari.svg' },
    { label: 'Mail', icon: '/icons/mail.svg' }
]);

const toggleMenu = (event) => {
    tieredMenu.value.toggle(event);
};

const onRightClick = (event) => {
    contextMenu.value.show(event);
};
</script>
```

## Charts with Chart.js Integration

Data visualization using the Chart component powered by Chart.js.

```vue
<template>
    <div class="grid grid-cols-2 gap-4">
        <!-- Bar Chart -->
        <Card>
            <template #title>Sales Overview</template>
            <template #content>
                <Chart type="bar" :data="barData" :options="barOptions" />
            </template>
        </Card>

        <!-- Line Chart -->
        <Card>
            <template #title>Revenue Trend</template>
            <template #content>
                <Chart type="line" :data="lineData" :options="lineOptions" />
            </template>
        </Card>

        <!-- Pie Chart -->
        <Card>
            <template #title>Market Share</template>
            <template #content>
                <Chart type="pie" :data="pieData" :options="pieOptions" />
            </template>
        </Card>

        <!-- Doughnut Chart -->
        <Card>
            <template #title>Categories</template>
            <template #content>
                <Chart type="doughnut" :data="doughnutData" :options="doughnutOptions" />
            </template>
        </Card>
    </div>
</template>

<script setup>
import { ref } from 'vue';
import Chart from 'primevue/chart';
import Card from 'primevue/card';

const barData = ref({
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
        {
            label: 'Sales 2024',
            data: [65, 59, 80, 81, 56, 55],
            backgroundColor: 'rgba(99, 102, 241, 0.5)',
            borderColor: 'rgb(99, 102, 241)',
            borderWidth: 1
        },
        {
            label: 'Sales 2023',
            data: [45, 49, 60, 71, 46, 45],
            backgroundColor: 'rgba(34, 197, 94, 0.5)',
            borderColor: 'rgb(34, 197, 94)',
            borderWidth: 1
        }
    ]
});

const barOptions = ref({
    responsive: true,
    plugins: {
        legend: { position: 'top' }
    },
    scales: {
        y: { beginAtZero: true }
    }
});

const lineData = ref({
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    datasets: [
        {
            label: 'Revenue',
            data: [28, 48, 40, 19, 86, 27],
            fill: true,
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            borderColor: 'rgb(99, 102, 241)',
            tension: 0.4
        }
    ]
});

const lineOptions = ref({
    responsive: true,
    plugins: {
        legend: { display: false }
    }
});

const pieData = ref({
    labels: ['Product A', 'Product B', 'Product C'],
    datasets: [
        {
            data: [300, 50, 100],
            backgroundColor: ['rgb(99, 102, 241)', 'rgb(34, 197, 94)', 'rgb(249, 115, 22)']
        }
    ]
});

const pieOptions = ref({
    responsive: true,
    plugins: {
        legend: { position: 'bottom' }
    }
});

const doughnutData = ref({
    labels: ['Electronics', 'Clothing', 'Home', 'Sports'],
    datasets: [
        {
            data: [540, 325, 702, 421],
            backgroundColor: [
                'rgb(99, 102, 241)',
                'rgb(34, 197, 94)',
                'rgb(249, 115, 22)',
                'rgb(236, 72, 153)'
            ]
        }
    ]
});

const doughnutOptions = ref({
    responsive: true,
    cutout: '60%',
    plugins: {
        legend: { position: 'right' }
    }
});
</script>
```

## Tabs and Accordion Components

Tab and accordion panels for organizing content in collapsible sections.

```vue
<template>
    <div class="flex flex-col gap-8">
        <!-- Basic Tabs -->
        <Tabs value="0">
            <TabList>
                <Tab value="0">Header I</Tab>
                <Tab value="1">Header II</Tab>
                <Tab value="2">Header III</Tab>
            </TabList>
            <TabPanels>
                <TabPanel value="0">
                    <p>Content for tab 1</p>
                </TabPanel>
                <TabPanel value="1">
                    <p>Content for tab 2</p>
                </TabPanel>
                <TabPanel value="2">
                    <p>Content for tab 3</p>
                </TabPanel>
            </TabPanels>
        </Tabs>

        <!-- Scrollable Tabs -->
        <Tabs value="0" scrollable>
            <TabList>
                <Tab v-for="i in 10" :key="i" :value="String(i - 1)">
                    Tab {{ i }}
                </Tab>
            </TabList>
            <TabPanels>
                <TabPanel v-for="i in 10" :key="i" :value="String(i - 1)">
                    <p>Content for Tab {{ i }}</p>
                </TabPanel>
            </TabPanels>
        </Tabs>

        <!-- Basic Accordion -->
        <Accordion value="0">
            <AccordionPanel value="0">
                <AccordionHeader>Header I</AccordionHeader>
                <AccordionContent>
                    <p>First accordion content</p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel value="1">
                <AccordionHeader>Header II</AccordionHeader>
                <AccordionContent>
                    <p>Second accordion content</p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel value="2">
                <AccordionHeader>Header III</AccordionHeader>
                <AccordionContent>
                    <p>Third accordion content</p>
                </AccordionContent>
            </AccordionPanel>
        </Accordion>

        <!-- Multiple Expansion -->
        <Accordion :multiple="true" :value="['0', '1']">
            <AccordionPanel value="0">
                <AccordionHeader>Section 1</AccordionHeader>
                <AccordionContent>
                    <p>Multiple panels can be open simultaneously</p>
                </AccordionContent>
            </AccordionPanel>
            <AccordionPanel value="1">
                <AccordionHeader>Section 2</AccordionHeader>
                <AccordionContent>
                    <p>This panel is also open by default</p>
                </AccordionContent>
            </AccordionPanel>
        </Accordion>

        <!-- Stepper -->
        <Stepper value="1">
            <StepList>
                <Step value="1">Personal</Step>
                <Step value="2">Address</Step>
                <Step value="3">Payment</Step>
            </StepList>
            <StepPanels>
                <StepPanel v-slot="{ activateCallback }" value="1">
                    <div class="flex flex-col gap-4">
                        <InputText placeholder="First Name" />
                        <InputText placeholder="Last Name" />
                        <Button label="Next" @click="activateCallback('2')" />
                    </div>
                </StepPanel>
                <StepPanel v-slot="{ activateCallback }" value="2">
                    <div class="flex flex-col gap-4">
                        <InputText placeholder="Address" />
                        <InputText placeholder="City" />
                        <div class="flex gap-2">
                            <Button label="Back" severity="secondary" @click="activateCallback('1')" />
                            <Button label="Next" @click="activateCallback('3')" />
                        </div>
                    </div>
                </StepPanel>
                <StepPanel v-slot="{ activateCallback }" value="3">
                    <div class="flex flex-col gap-4">
                        <InputText placeholder="Card Number" />
                        <div class="flex gap-2">
                            <Button label="Back" severity="secondary" @click="activateCallback('2')" />
                            <Button label="Submit" />
                        </div>
                    </div>
                </StepPanel>
            </StepPanels>
        </Stepper>
    </div>
</template>

<script setup>
import Tabs from 'primevue/tabs';
import TabList from 'primevue/tablist';
import Tab from 'primevue/tab';
import TabPanels from 'primevue/tabpanels';
import TabPanel from 'primevue/tabpanel';
import Accordion from 'primevue/accordion';
import AccordionPanel from 'primevue/accordionpanel';
import AccordionHeader from 'primevue/accordionheader';
import AccordionContent from 'primevue/accordioncontent';
import Stepper from 'primevue/stepper';
import StepList from 'primevue/steplist';
import Step from 'primevue/step';
import StepPanels from 'primevue/steppanels';
import StepPanel from 'primevue/steppanel';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
</script>
```

## Pass Through (PT) API

Customize component internals using the Pass Through API for styling and attribute injection.

```vue
<template>
    <div>
        <!-- Component-level PT -->
        <InputText
            v-model="value"
            :pt="{
                root: {
                    class: 'custom-input',
                    style: { borderRadius: '10px' }
                }
            }"
        />

        <!-- DataTable with PT -->
        <DataTable
            :value="products"
            :pt="{
                root: { class: 'custom-table' },
                header: { class: 'bg-primary text-white' },
                bodyRow: ({ context }) => ({
                    class: context.index % 2 === 0 ? 'bg-surface-50' : 'bg-surface-0'
                }),
                column: {
                    headerCell: { class: 'font-bold' },
                    bodyCell: { class: 'text-sm' }
                }
            }"
        >
            <Column field="name" header="Name" />
            <Column field="price" header="Price" />
        </DataTable>

        <!-- Button with conditional PT -->
        <Button
            label="Submit"
            :pt="{
                root: ({ props }) => ({
                    class: props.loading ? 'opacity-50' : ''
                }),
                label: { class: 'font-semibold' }
            }"
        />
    </div>
</template>

<script setup>
import { ref } from 'vue';
import InputText from 'primevue/inputtext';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Button from 'primevue/button';

const value = ref('');
const products = ref([
    { name: 'Product 1', price: 100 },
    { name: 'Product 2', price: 200 }
]);
</script>
```

```javascript
// Global PT configuration in main.js
import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';

const app = createApp(App);

app.use(PrimeVue, {
    theme: { preset: Aura },
    pt: {
        // Global PT for all Buttons
        button: {
            root: { class: 'rounded-full' },
            label: { class: 'font-medium' }
        },
        // Global PT for all InputText
        inputtext: {
            root: ({ props }) => ({
                class: [
                    'transition-all duration-200',
                    { 'border-red-500': props.invalid }
                ]
            })
        },
        // Global PT for DataTable
        datatable: {
            root: { class: 'shadow-lg rounded-lg overflow-hidden' },
            header: { class: 'bg-surface-50 border-b' },
            bodyRow: { class: 'hover:bg-surface-100 transition-colors' }
        }
    },
    ptOptions: {
        mergeSections: true,
        mergeProps: true
    }
});
```

## Summary

PrimeVue provides a complete solution for building enterprise-grade Vue.js applications with its extensive component library covering forms, data display, overlays, navigation, and visualizations. The library excels in scenarios requiring complex data tables with sorting, filtering, pagination, and editing; multi-step forms with validation using popular schema libraries; rich theming capabilities through design tokens; and accessible, responsive UI components. The Pass Through API and design token system enable deep customization while maintaining consistency across applications.

Integration patterns include direct Vue 3 setup with the PrimeVue plugin, Nuxt 3 applications using the official module with auto-import capabilities, and custom theme presets using definePreset for brand-specific styling. The @primevue/forms package provides a powerful abstraction for form state management with support for Zod, Yup, and Valibot validation libraries. Whether building admin dashboards, e-commerce platforms, or data-intensive applications, PrimeVue's combination of comprehensive components, flexible theming, and strong TypeScript support makes it a robust choice for Vue.js development.