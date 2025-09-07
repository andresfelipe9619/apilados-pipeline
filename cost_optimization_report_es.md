
# Informe de Optimización de Costos y Mejora de Infraestructura: Apilados Pipeline

**Fecha:** 7 de Septiembre de 2025

## 1. Resumen Ejecutivo

Este informe detalla la implementación exitosa de medidas de ahorro de costos y mejoras de infraestructura para el proyecto Apilados Pipeline. Al optimizar nuestro uso de los recursos de AWS, hemos logrado reducciones de costos significativas al mismo tiempo que lanzamos un nuevo y eficiente microservicio.

Las acciones clave que se tomaron fueron:
*   **Automatización del encendido y apagado de nuestra instancia EC2 utilizando dos nuevas funciones de AWS Lambda.**
*   **Lanzamiento de un nuevo microservicio de ingesta de datos, rentable y sin servidor (serverless) utilizando AWS Lambda.**

Estos cambios han resultado en un **ahorro mensual estimado de $11.53**, lo que representa una **reducción del 25% en el costo operativo total** de la instancia y su almacenamiento asociado.

## 2. Antecedentes

La instancia EC2 principal del proyecto, de tipo `t2.small`, se mantenía en funcionamiento 24/7, lo que generaba costos innecesarios durante los períodos de inactividad. Además, existía la necesidad de introducir un nuevo servicio de ingesta de datos de una manera rentable y escalable.

## 3. Acciones Tomadas

Para abordar estos puntos, implementamos los siguientes cambios:

*   **Automatización de la Instancia EC2:** Desarrollamos e implementamos dos nuevas funciones especializadas de AWS Lambda (`start-ec2` y `stop-ec2`). Estas funciones son activadas por un programador para iniciar automáticamente la instancia EC2 durante su ventana operativa diaria de 8 horas y apagarla después.

*   **Nuevo Microservicio de Ingesta Serverless:** Desarrollamos y lanzamos un nuevo microservicio independiente para la ingesta de datos utilizando AWS Lambda. Este enfoque sin servidor (serverless) asegura que solo paguemos por el tiempo de cómputo cuando se están ingiriendo datos (una vez por semana), y puede escalar automáticamente sin requerir un servidor dedicado y siempre encendido.

## 4. Análisis de Costos

El principal ahorro de costos proviene de la reducción del tiempo de ejecución de la instancia EC2. El costo de almacenamiento EBS asociado permanece constante, ya que es necesario para persistir los datos independientemente de si la instancia está en funcionamiento.

La siguiente tabla proporciona un desglose completo de todos los costos asociados con esta parte del proyecto:

| Componente                | Costo Mensual Anterior | Costo Mensual Actual | Ahorro Mensual  |
| ------------------------- | ---------------------- | -------------------- | --------------- |
| **Costo de Cómputo (EC2)** | **$17.11**             | **$5.58**            | **$11.53**      |
| **Costo de Almacenamiento (EBS)** | $28.26                 | $28.26               | $0.00           |
| **Total**                 | **$45.37**             | **$33.84**           | **$11.53**      |

--- 

### Entendiendo los Porcentajes

*   **Reducción del 67% en el Costo de Cómputo:** Este significativo porcentaje refleja el ahorro directo en la porción de cómputo de EC2 de la factura, que fue el objetivo de nuestra optimización. Hemos logrado reducir este costo específico en dos tercios.

*   **Reducción General del 25%:** Este porcentaje representa el impacto en la factura mensual total de la instancia y su almacenamiento. Es el reflejo más preciso del ahorro financiero general logrado.

## 5. Beneficios e Impacto

Esta iniciativa ha generado varios beneficios clave:

*   **Reducción Significativa de Costos:** Hemos logrado una **reducción del 67% en los costos** de la instancia EC2, lo que se traduce en ahorros mensuales directos y recurrentes.
*   **Mayor Automatización:** El mecanismo automatizado de encendido/apagado reduce la carga de trabajo manual y garantiza una gestión de recursos consistente y fiable.
*   **Nuevo Servicio Escalable:** El nuevo microservicio de ingesta está construido sobre una arquitectura moderna y sin servidor, lo que le permite escalar de forma independiente y rentable sin afectar a otros sistemas.
*   **Prácticas Sostenibles en la Nube:** Estos cambios alinean nuestro proyecto con las mejores prácticas de AWS para la gestión de costos y la excelencia operativa.

## 6. Conclusión

Esta iniciativa ha reducido con éxito los costos operativos de nuestra infraestructura existente al tiempo que ha introducido un nuevo y eficiente microservicio. Los cambios implementados mejoran nuestra arquitectura, reducen el esfuerzo manual y demuestran nuestro compromiso con la creación de soluciones escalables y financieramente responsables.
